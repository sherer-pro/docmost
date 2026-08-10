import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { request } from "@playwright/test";
import { sanitizeAuditArtifacts } from "./sanitize-artifacts.mjs";

const require = createRequire(import.meta.url);
const clientRoot = path.resolve(import.meta.dirname, "../..");
const repoRoot = path.resolve(clientRoot, "../..");
const auditRoot = path.resolve(
  process.env.DOCMOST_EDITOR_AUDIT_ROOT ??
    path.join(repoRoot, "output/audit/page-templates-transclusion-2026-08-09"),
);
const statePath = path.join(auditRoot, "audit-state.json");
const defectsPath = path.join(auditRoot, "confirmed-defects.json");
const baseURL = (
  process.env.DOCMOST_BASE_URL ?? "http://localhost:3000"
).replace(/\/$/, "");
const apiBaseURL = (process.env.DOCMOST_API_BASE_URL ?? baseURL).replace(
  /\/$/,
  "",
);
const apiOrigin = (process.env.DOCMOST_API_ORIGIN ?? baseURL).replace(
  /\/$/,
  "",
);
const apiHost = new URL(apiOrigin).host;
process.env.DOCMOST_WEBKIT_BASE_URL ??= baseURL;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be supplied at runtime`);
  return value;
}

function unwrap(payload) {
  return payload &&
    typeof payload === "object" &&
    "success" in payload &&
    "data" in payload
    ? payload.data
    : payload;
}

async function responseJson(response) {
  const text = await response.text();
  if (!response.ok()) {
    throw new Error(
      `${new URL(response.url()).pathname} failed with ${response.status()}: ${text.slice(0, 500)}`,
    );
  }
  return text ? unwrap(JSON.parse(text)) : undefined;
}

async function createApi() {
  const csrfToken = required("DOCMOST_CSRF_TOKEN");
  const authToken = required("DOCMOST_AUTH_TOKEN");
  return request.newContext({
    baseURL: apiBaseURL,
    timeout: 20_000,
    extraHTTPHeaders: {
      Authorization: `Bearer ${authToken}`,
      Cookie: `csrfToken=${csrfToken}`,
      Host: apiHost,
      Origin: apiOrigin,
      Referer: `${apiOrigin}/`,
      "x-csrf-token": csrfToken,
      Accept: "application/json",
    },
  });
}

async function provisionSharedAuditMember(api, spaceId) {
  const workspace = await responseJson(await api.get("/api/workspace/info"));
  const emailDomain = workspace.emailDomains?.[0] ?? "example.com";
  const suffix = randomBytes(5).toString("hex");
  const email = `templates-transclusion-${suffix}@${emailDomain}`;
  const password = `Aa1!${randomBytes(18).toString("base64url")}`;

  await responseJson(
    await api.post("/api/workspace/invites/create", {
      data: { emails: [email], role: "member", groupIds: [] },
    }),
  );
  const invites = await responseJson(
    await api.get("/api/workspace/invites?limit=100"),
  );
  const invitation = (invites.items ?? invites.data ?? []).find(
    (item) => item.email === email,
  );
  if (!invitation) throw new Error("Shared audit invitation was not found");
  const link = await responseJson(
    await api.post("/api/workspace/invites/link", {
      data: { invitationId: invitation.id },
    }),
  );
  const invitationUrl = new URL(link.inviteLink);
  const invitationId = invitationUrl.pathname.split("/").filter(Boolean).at(-1);
  const token = invitationUrl.searchParams.get("token");
  if (!invitationId || !token) {
    throw new Error("Shared audit invitation link is incomplete");
  }

  const memberApi = await request.newContext({
    baseURL: apiBaseURL,
    extraHTTPHeaders: {
      Host: apiHost,
      Origin: apiOrigin,
      Referer: `${apiOrigin}/`,
    },
  });
  try {
    await responseJson(
      await memberApi.post("/api/workspace/invites/accept", {
        data: {
          invitationId,
          token,
          name: "Templates and transclusion audit member",
          password,
        },
      }),
    );
    const member = await responseJson(await memberApi.get("/api/users/me"));
    const storage = await memberApi.storageState();
    const authToken = storage.cookies.find(
      (cookie) => cookie.name === "authToken",
    )?.value;
    const csrfToken = storage.cookies.find(
      (cookie) => cookie.name === "csrfToken",
    )?.value;
    if (!authToken || !csrfToken || !member.user?.id) {
      throw new Error("Shared audit member session is incomplete");
    }
    await responseJson(
      await api.post("/api/spaces/members/add", {
        data: {
          spaceId,
          role: "writer",
          userIds: [member.user.id],
          groupIds: [],
        },
      }),
    );
    process.env.DOCMOST_AUDIT_MEMBER_AUTH_TOKEN = authToken;
    process.env.DOCMOST_AUDIT_MEMBER_CSRF_TOKEN = csrfToken;
    process.env.DOCMOST_AUDIT_MEMBER_USER_ID = member.user.id;
    return member.user.id;
  } finally {
    await memberApi.dispose();
  }
}

async function ensureRuntimeAuth() {
  if (
    process.env.DOCMOST_AUTH_TOKEN?.trim() &&
    process.env.DOCMOST_CSRF_TOKEN?.trim()
  ) {
    return;
  }
  const email = required("DOCMOST_ADMIN_EMAIL");
  const password = required("DOCMOST_ADMIN_PASSWORD");
  const loginContext = await request.newContext({
    baseURL: apiBaseURL,
    extraHTTPHeaders: { Origin: apiOrigin, Referer: `${apiOrigin}/` },
  });
  try {
    const response = await loginContext.post("/api/auth/login", {
      data: { email, password },
    });
    if (!response.ok()) {
      throw new Error(`Audit admin login failed with ${response.status()}`);
    }
    const storage = await loginContext.storageState();
    const authToken = storage.cookies.find(
      (cookie) => cookie.name === "authToken",
    )?.value;
    const csrfToken = storage.cookies.find(
      (cookie) => cookie.name === "csrfToken",
    )?.value;
    if (!authToken || !csrfToken) {
      throw new Error("Audit admin login did not return the required cookies");
    }
    process.env.DOCMOST_AUTH_TOKEN = authToken;
    process.env.DOCMOST_CSRF_TOKEN = csrfToken;
  } finally {
    await loginContext.dispose();
  }
}

async function runPlaywright() {
  const cli = require.resolve("@playwright/test/cli");
  const selectedFiles = (process.env.DOCMOST_EDITOR_AUDIT_FILES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [cli, "test", "--config=playwright.editor.config.ts", ...selectedFiles],
      {
        cwd: clientRoot,
        env: process.env,
        stdio: "inherit",
      },
    );
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

await fs.mkdir(auditRoot, { recursive: true });
for (const directory of [
  "axe-results",
  "console-errors",
  "downloads",
  "playwright-artifacts",
  "playwright-html",
  "screenshots",
]) {
  const generatedDirectory = path.join(auditRoot, directory);
  await fs.rm(generatedDirectory, { recursive: true, force: true });
  await fs.mkdir(generatedDirectory, { recursive: true });
}
await fs.writeFile(defectsPath, "[]\n", "utf8");
await ensureRuntimeAuth();
const api = await createApi();
let state;
let exitCode = 1;
let originalWorkspaceTemplatePolicy;
let sharedAuditMemberUserId;

try {
  const runId = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  originalWorkspaceTemplatePolicy = await responseJson(
    await api.get("/api/pages/templates/policies/workspace"),
  );
  if (!originalWorkspaceTemplatePolicy.systemEnabled) {
    throw new Error("Page templates are disabled by the deployment policy");
  }
  if (!originalWorkspaceTemplatePolicy.enabled) {
    await responseJson(
      await api.patch("/api/pages/templates/policies/workspace", {
        data: {
          enabled: true,
          expectedRevision: originalWorkspaceTemplatePolicy.revision,
        },
      }),
    );
  }
  const space = await responseJson(
    await api.post("/api/spaces", {
      data: {
        name: `Editor audit ${runId}`,
        slug: `editoraudit${runId}`,
        description: "Isolated browser regression audit space.",
      },
    }),
  );
  state = {
    runId,
    spaceId: space.id,
    spaceSlug: space.slug,
    spaceName: space.name,
    retained: true,
    createdAt: new Date().toISOString(),
  };
  await responseJson(
    await api.patch(`/api/spaces/${space.id}`, {
      data: { disablePublicSharing: false },
    }),
  );
  const spaceTemplatePolicy = await responseJson(
    await api.get(`/api/pages/templates/policies/spaces/${space.id}`),
  );
  await responseJson(
    await api.put(`/api/pages/templates/policies/spaces/${space.id}`, {
      data: {
        ...spaceTemplatePolicy,
        templatesEnabled: true,
        allowCreateTemplate: true,
        allowRegularTemplate: true,
        allowSyncedTemplate: true,
        expectedRevision: spaceTemplatePolicy.revision,
      },
    }),
  );
  try {
    sharedAuditMemberUserId = await provisionSharedAuditMember(api, space.id);
  } catch (error) {
    await responseJson(await api.delete(`/api/spaces/${space.id}`)).catch(
      () => undefined,
    );
    state.retained = false;
    state.deletedAt = new Date().toISOString();
    state.setupFailure = true;
    await fs.writeFile(
      statePath,
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8",
    );
    throw error;
  }
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  exitCode = await runPlaywright();
  const sanitization = await sanitizeAuditArtifacts(auditRoot);
  if (sanitization.credentialFindings > 0) {
    throw new Error(
      "Sanitized editor audit artifacts still contain credentials",
    );
  }
  const confirmedDefects = JSON.parse(await fs.readFile(defectsPath, "utf8"));
  if (exitCode === 0 && confirmedDefects.length === 0) {
    await responseJson(await api.delete(`/api/spaces/${state.spaceId}`));
    state.retained = false;
    state.deletedAt = new Date().toISOString();
    await fs.writeFile(
      statePath,
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8",
    );
  } else {
    state.confirmedDefects = confirmedDefects.length;
    state.retainedReason = exitCode !== 0 ? "test-failure" : "confirmed-defect";
    if (exitCode !== 0) {
      state.failureExitCode = exitCode;
    }
    await fs.writeFile(
      statePath,
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8",
    );
  }
} finally {
  if (sharedAuditMemberUserId) {
    await responseJson(
      await api.post("/api/workspace/members/delete", {
        data: { userId: sharedAuditMemberUserId },
      }),
    ).catch(() => undefined);
  }
  delete process.env.DOCMOST_AUDIT_MEMBER_AUTH_TOKEN;
  delete process.env.DOCMOST_AUDIT_MEMBER_CSRF_TOKEN;
  delete process.env.DOCMOST_AUDIT_MEMBER_USER_ID;
  if (
    originalWorkspaceTemplatePolicy &&
    originalWorkspaceTemplatePolicy.systemEnabled
  ) {
    const currentPolicy = await responseJson(
      await api.get("/api/pages/templates/policies/workspace"),
    ).catch(() => null);
    if (
      currentPolicy &&
      currentPolicy.enabled !== originalWorkspaceTemplatePolicy.enabled
    ) {
      await responseJson(
        await api.patch("/api/pages/templates/policies/workspace", {
          data: {
            enabled: originalWorkspaceTemplatePolicy.enabled,
            expectedRevision: currentPolicy.revision,
          },
        }),
      ).catch(() => undefined);
    }
  }
  await api.dispose();
}

process.exitCode = exitCode;
