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
) {
  return api.post(`/api/ai/conversations/${conversation.id}/messages`, {
    data: {
      content,
      clientRequestId: randomUUID(),
      contextRevision: conversation.contextRevision ?? 0,
    },
  });
}

async function waitForTerminalRun(api: APIRequestContext, runId: string) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const response = await api.get(`/api/ai/runs/${runId}`);
    expect(response.ok()).toBe(true);
    const run = unwrap<{ status: string }>(await response.json());
    if (["completed", "failed", "cancelled"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`AI run ${runId} did not become terminal`);
}

async function patchLimits(
  ownerApi: APIRequestContext,
  spaceId: string,
  dailyRequestLimitPerUser: number,
  dailyTokenLimitPerSpace: number,
) {
  const response = await ownerApi.patch(`/api/spaces/${spaceId}/ai/config`, {
    data: { dailyRequestLimitPerUser, dailyTokenLimitPerSpace },
  });
  expect([200, 201]).toContain(response.status());
}

test("long prompts, message pagination and quota limits remain bounded", async () => {
  const state = await loadState();
  const origin = process.env.DOCMOST_BASE_URL ?? "http://localhost:3000";
  const quotaIdentity = JSON.parse(
    process.env.DOCMOST_QUOTA_IDENTITY ?? "null",
  ) as Identity | null;
  expect(quotaIdentity).not.toBeNull();
  const ownerApi = await apiContext(
    {
      authToken: process.env.DOCMOST_AUTH_TOKEN!,
      csrfToken: process.env.DOCMOST_CSRF_TOKEN!,
    },
    origin,
  );
  const quotaApi = await apiContext(quotaIdentity!, origin);
  const evidence: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
  };

  try {
    const paginationConversation = await createConversation(
      ownerApi,
      state.pageId,
      "Pagination and long prompt audit",
    );
    const longPrompt = `AUDIT_LONG_${"x".repeat(31_980)}`;
    for (const content of [
      longPrompt,
      "AUDIT_PAGINATION_SECOND",
      "AUDIT_PAGINATION_THIRD",
    ]) {
      const response = await send(ownerApi, paginationConversation, content);
      expect(response.status()).toBe(202);
      const payload = unwrap<{ run: { id: string } }>(await response.json());
      expect((await waitForTerminalRun(ownerApi, payload.run.id)).status).toBe(
        "completed",
      );
    }

    const firstPageResponse = await ownerApi.get(
      `/api/ai/conversations/${paginationConversation.id}/messages?limit=2`,
    );
    expect(firstPageResponse.ok()).toBe(true);
    const firstPage = unwrap<{
      items: Array<{ id: string }>;
      hasMore: boolean;
      nextCursor: string | null;
    }>(await firstPageResponse.json());
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBeTruthy();
    const secondPageResponse = await ownerApi.get(
      `/api/ai/conversations/${paginationConversation.id}/messages?limit=2&before=${firstPage.nextCursor}`,
    );
    expect(secondPageResponse.ok()).toBe(true);
    const secondPage = unwrap<{ items: Array<{ id: string }> }>(
      await secondPageResponse.json(),
    );
    expect(secondPage.items).toHaveLength(2);
    expect(
      secondPage.items.some((item) =>
        firstPage.items.some((first) => first.id === item.id),
      ),
    ).toBe(false);
    evidence.pagination = {
      firstPageItems: firstPage.items.length,
      secondPageItems: secondPage.items.length,
      overlap: 0,
      longPromptCharacters: longPrompt.length,
    };

    await patchLimits(ownerApi, state.spaceId, 1, 2_000_000);
    const requestQuotaConversation = await createConversation(
      quotaApi,
      state.pageId,
      "Request quota audit",
    );
    const accepted = await send(
      quotaApi,
      requestQuotaConversation,
      "AUDIT_REQUEST_QUOTA_FIRST",
    );
    expect(accepted.status()).toBe(202);
    const acceptedPayload = unwrap<{ run: { id: string } }>(
      await accepted.json(),
    );
    expect(
      (await waitForTerminalRun(quotaApi, acceptedPayload.run.id)).status,
    ).toBe("completed");
    const rejectedConversation = await createConversation(
      quotaApi,
      state.pageId,
      "Request quota overflow",
    );
    const requestRejected = await send(
      quotaApi,
      rejectedConversation,
      "AUDIT_REQUEST_QUOTA_SECOND",
    );
    expect(requestRejected.status()).toBe(429);
    expect(JSON.stringify(await requestRejected.json())).toContain(
      "ai_daily_request_limit",
    );

    await patchLimits(ownerApi, state.spaceId, 100, 1);
    const tokenQuotaConversation = await createConversation(
      quotaApi,
      state.pageId,
      "Token quota overflow",
    );
    const tokenRejected = await send(
      quotaApi,
      tokenQuotaConversation,
      "AUDIT_TOKEN_QUOTA",
    );
    expect(tokenRejected.status()).toBe(429);
    expect(JSON.stringify(await tokenRejected.json())).toContain(
      "ai_daily_token_limit",
    );
    evidence.quotas = {
      requestAccepted: accepted.status(),
      requestRejected: requestRejected.status(),
      tokenRejected: tokenRejected.status(),
    };
    await fs.writeFile(
      path.join(auditRoot, "quota-pagination-evidence.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  } finally {
    await patchLimits(ownerApi, state.spaceId, 100, 2_000_000).catch(
      () => undefined,
    );
    await quotaApi.dispose();
    await ownerApi.dispose();
  }
});
