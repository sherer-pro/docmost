import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  request as apiRequest,
  type APIRequestContext,
} from "@playwright/test";
import { auditRoot, expect, loadState, test } from "../support";

type Identity = { authToken: string; csrfToken: string };

function unwrap<T>(payload: { data?: T; success?: boolean } | T): T {
  if (
    payload &&
    typeof payload === "object" &&
    "success" in payload &&
    "data" in payload
  ) {
    return payload.data as T;
  }
  return payload as T;
}

async function apiContext(identity: Identity, origin: string) {
  return apiRequest.newContext({
    baseURL: origin,
    timeout: 30_000,
    extraHTTPHeaders: {
      Authorization: `Bearer ${identity.authToken}`,
      Cookie: `csrfToken=${identity.csrfToken}`,
      Origin: origin,
      Referer: `${origin}/`,
      "x-csrf-token": identity.csrfToken,
      Accept: "application/json",
    },
  });
}

async function createConversation(
  api: APIRequestContext,
  pageId: string,
  title: string,
) {
  const response = await api.post("/api/ai/conversations", {
    data: { pageId, title, clientRequestId: randomUUID() },
  });
  expect(response.status()).toBe(201);
  return unwrap<{ id: string; contextRevision: number }>(await response.json());
}

async function send(
  api: APIRequestContext,
  conversation: { id: string; contextRevision: number },
  content: string,
  clientRequestId = randomUUID(),
) {
  return api.post(`/api/ai/conversations/${conversation.id}/messages`, {
    data: {
      content,
      clientRequestId,
      contextRevision: conversation.contextRevision ?? 0,
    },
  });
}

async function waitForTerminalRun(api: APIRequestContext, runId: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const response = await api.get(`/api/ai/runs/${runId}`);
    expect(response.ok()).toBe(true);
    const run = unwrap<{ status: string }>(await response.json());
    if (["completed", "failed", "cancelled"].includes(run.status)) {
      return run.status;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`AI run ${runId} did not become terminal after cancellation`);
}

test("message idempotency rejects payload drift and keeps one immutable run", async () => {
  const state = await loadState();
  const origin = process.env.DOCMOST_BASE_URL ?? "http://localhost:3000";
  const api = await apiContext(
    {
      authToken: process.env.DOCMOST_AUTH_TOKEN!,
      csrfToken: process.env.DOCMOST_CSRF_TOKEN!,
    },
    origin,
  );
  try {
    const conversation = await createConversation(
      api,
      state.pageId,
      "Idempotency audit",
    );
    const key = `send-${randomUUID()}`;
    const first = await send(api, conversation, "AUDIT_IDEMPOTENT", key);
    expect(first.status()).toBe(202);
    const replay = await send(api, conversation, "AUDIT_IDEMPOTENT", key);
    expect(replay.status()).toBe(202);
    const firstPayload = unwrap<{
      run: { id: string };
      userMessage: { id: string };
    }>(await first.json());
    const replayPayload = unwrap<{
      run: { id: string };
      userMessage: { id: string };
    }>(await replay.json());
    expect(replayPayload.run.id).toBe(firstPayload.run.id);
    expect(replayPayload.userMessage.id).toBe(firstPayload.userMessage.id);

    const drift = await send(api, conversation, "AUDIT_DIFFERENT", key);
    expect(drift.status()).toBe(409);
    const driftPayload = await drift.json();
    expect(JSON.stringify(driftPayload)).toContain("idempotency_key_reused");
  } finally {
    await api.dispose();
  }
});

test("per-user concurrency releases after cancellation", async () => {
  const state = await loadState();
  const origin = process.env.DOCMOST_BASE_URL ?? "http://localhost:3000";
  const api = await apiContext(
    {
      authToken: process.env.DOCMOST_AUTH_TOKEN!,
      csrfToken: process.env.DOCMOST_CSRF_TOKEN!,
    },
    origin,
  );
  const runIds: string[] = [];
  try {
    const conversations = await Promise.all(
      Array.from({ length: 7 }, (_, index) =>
        createConversation(api, state.pageId, `User concurrency ${index + 1}`),
      ),
    );
    const accepted = await Promise.all(
      conversations
        .slice(0, 6)
        .map((conversation) =>
          send(api, conversation, `AUDIT_DELAY_USER_${conversation.id}`),
        ),
    );
    expect(accepted.map((response) => response.status())).toEqual(
      Array(6).fill(202),
    );
    for (const response of accepted) {
      const payload = unwrap<{ run: { id: string } }>(await response.json());
      runIds.push(payload.run.id);
    }
    const overflow = await send(
      api,
      conversations[6],
      "AUDIT_DELAY_USER_OVERFLOW",
    );
    expect(overflow.status()).toBe(409);
    expect(JSON.stringify(await overflow.json())).toContain(
      "ai_conversation_busy",
    );
    await Promise.all(
      runIds.map(async (runId) => {
        const response = await api.post(`/api/ai/runs/${runId}/actions/cancel`);
        expect([200, 201, 409]).toContain(response.status());
      }),
    );
    await Promise.all(runIds.map((runId) => waitForTerminalRun(api, runId)));
    const released = await send(
      api,
      conversations[6],
      "AUDIT_NORMAL_AFTER_USER_CONCURRENCY",
    );
    expect(released.status()).toBe(202);
  } finally {
    await Promise.all(
      runIds.map((runId) =>
        api.post(`/api/ai/runs/${runId}/actions/cancel`).catch(() => undefined),
      ),
    );
    await api.dispose();
  }
});

test("space concurrency limit releases after cancellation", async () => {
  const state = await loadState();
  const origin = process.env.DOCMOST_BASE_URL ?? "http://localhost:3000";
  const members = JSON.parse(
    process.env.DOCMOST_CONCURRENCY_IDENTITIES ?? "[]",
  ) as Identity[];
  const identities: Identity[] = [
    {
      authToken: process.env.DOCMOST_AUTH_TOKEN!,
      csrfToken: process.env.DOCMOST_CSRF_TOKEN!,
    },
    ...members,
  ];
  expect(identities).toHaveLength(6);
  const apis = await Promise.all(
    identities.map((identity) => apiContext(identity, origin)),
  );
  const acceptedRuns: string[] = [];
  try {
    const firstThirty = await Promise.all(
      Array.from({ length: 30 }, async (_, index) => {
        const api = apis[Math.floor(index / 6)];
        const conversation = await createConversation(
          api,
          state.pageId,
          `Concurrency ${index + 1}`,
        );
        return { api, conversation };
      }),
    );
    const accepted = await Promise.all(
      firstThirty.map(({ api, conversation }) =>
        send(api, conversation, `AUDIT_DELAY_SPACE_${conversation.id}`),
      ),
    );
    expect(accepted.map((response) => response.status())).toEqual(
      Array(30).fill(202),
    );
    for (const response of accepted) {
      const payload = unwrap<{ run: { id: string } }>(await response.json());
      acceptedRuns.push(payload.run.id);
    }

    const overflowConversation = await createConversation(
      apis[5],
      state.pageId,
      "Space overflow",
    );
    const overflow = await send(
      apis[5],
      overflowConversation,
      "AUDIT_DELAY_SPACE_OVERFLOW",
    );
    expect(overflow.status()).toBe(409);
    expect(JSON.stringify(await overflow.json())).toContain(
      "ai_conversation_busy",
    );

    await Promise.all(
      acceptedRuns.map(async (runId, index) => {
        const response = await apis[Math.floor(index / 6)].post(
          `/api/ai/runs/${runId}/actions/cancel`,
        );
        expect([200, 201, 409]).toContain(response.status());
      }),
    );
    await Promise.all(
      acceptedRuns.map((runId, index) =>
        waitForTerminalRun(apis[Math.floor(index / 6)], runId),
      ),
    );

    const releasedConversation = await createConversation(
      apis[5],
      state.pageId,
      "Released slot",
    );
    const released = await send(
      apis[5],
      releasedConversation,
      "AUDIT_NORMAL_AFTER_CONCURRENCY",
    );
    expect(released.status()).toBe(202);
    await fs.writeFile(
      path.join(auditRoot, "concurrency-evidence.json"),
      `${JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          identities: identities.length,
          acceptedBeforeSpaceLimit: acceptedRuns.length,
          overflowStatus: overflow.status(),
          acceptedAfterCancellation: released.status(),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await Promise.all(
      acceptedRuns.map((runId, index) =>
        apis[Math.floor(index / 6)]
          .post(`/api/ai/runs/${runId}/actions/cancel`)
          .catch(() => undefined),
      ),
    );
    await Promise.all(apis.map((api) => api.dispose()));
  }
});
