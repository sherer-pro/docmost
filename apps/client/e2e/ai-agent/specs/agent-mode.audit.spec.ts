import { expect, request, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

type JsonRecord = Record<string, any>;

const baseURL = (process.env.DOCMOST_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const origin = new URL(baseURL).origin;
const auditRoot = path.resolve(process.env.DOCMOST_AI_AGENT_AUDIT_ROOT ?? ".");
const modelControlUrl = process.env.DOCMOST_AI_AGENT_MODEL_CONTROL_URL ?? "http://127.0.0.1:1180";
const toxiproxyUrl = process.env.DOCMOST_AI_AGENT_TOXIPROXY_URL ?? "http://127.0.0.1:18474";
const composeProject = process.env.DOCMOST_AI_AGENT_COMPOSE_PROJECT ?? "";
const repoRoot = path.resolve(process.cwd(), "../..");
const composeFiles = [
  path.join(repoRoot, "docker-compose.yml"),
  path.join(repoRoot, "apps/client/e2e/ai-agent/docker-compose.audit.yml"),
];
const transitionJournal: JsonRecord[] = [];

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be supplied at runtime`);
  return value;
}

function unwrap<T>(payload: any): T {
  return payload && typeof payload === "object" && "success" in payload && "data" in payload
    ? payload.data as T
    : payload as T;
}

async function api<T = any>(
  context: APIRequestContext,
  method: string,
  url: string,
  data?: unknown,
  allowFailure = false,
): Promise<{ ok: boolean; status: number; payload: T; text: string }> {
  const response = await context.fetch(url, {
    method,
    ...(data === undefined ? {} : { data }),
  });
  const text = await response.text();
  let payload: any;
  try {
    payload = text ? unwrap(JSON.parse(text)) : undefined;
  } catch {
    payload = text;
  }
  if (!response.ok() && !allowFailure) {
    throw new Error(`${new URL(response.url()).pathname} returned ${response.status()}: ${text.slice(0, 500)}`);
  }
  return { ok: response.ok(), status: response.status(), payload, text };
}

async function adminApi(): Promise<APIRequestContext> {
  const authToken = required("DOCMOST_AUTH_TOKEN");
  const csrfToken = required("DOCMOST_CSRF_TOKEN");
  return request.newContext({
    baseURL,
    extraHTTPHeaders: {
      Authorization: `Bearer ${authToken}`,
      Cookie: `csrfToken=${csrfToken}`,
      Origin: origin,
      Referer: `${origin}/`,
      "x-csrf-token": csrfToken,
      Accept: "application/json",
    },
  });
}

function adminStorageState() {
  const parsed = new URL(baseURL);
  const defaults = {
    domain: parsed.hostname,
    path: "/",
    secure: parsed.protocol === "https:",
    sameSite: "Lax" as const,
  };
  return {
    cookies: [
      { ...defaults, name: "authToken", value: required("DOCMOST_AUTH_TOKEN"), httpOnly: true },
      { ...defaults, name: "csrfToken", value: required("DOCMOST_CSRF_TOKEN"), httpOnly: false },
    ],
    origins: [],
  };
}

async function waitFor<T>(description: string, predicate: () => Promise<T | undefined | false>, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${description} timed out${lastError instanceof Error ? `: ${lastError.message}` : ""}`);
}

function paragraph(value: string, id = randomUUID()): JsonRecord {
  return { type: "paragraph", attrs: { id }, content: [{ type: "text", text: value }] };
}

function complexDocument(marker: string): JsonRecord {
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { id: randomUUID(), level: 2 }, content: [{ type: "text", text: `${marker} heading` }] },
      paragraph(`${marker} editable paragraph`),
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [paragraph(`${marker} list item`)] }],
      },
      {
        type: "table",
        attrs: { widthMode: "full" },
        content: [{ type: "tableRow", content: [
          { type: "tableHeader", content: [paragraph(`${marker} table header`)] },
          { type: "tableCell", content: [paragraph(`${marker} table value`)] },
        ] }],
      },
      { type: "codeBlock", attrs: { language: "typescript", widthMode: "normal" }, content: [{ type: "text", text: `const marker = ${JSON.stringify(marker)};` }] },
      { type: "embed", attrs: { src: "https://example.com/", provider: "iframe", width: 640, height: 360, align: "center" } },
      { type: "transclusionSource", attrs: { id: randomUUID() }, content: [paragraph(`${marker} synced source`)] },
    ],
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function textOf(node: any): string {
  if (typeof node?.text === "string") return node.text;
  return Array.isArray(node?.content) ? node.content.map(textOf).join("") : "";
}

function nodesOfType(node: any, types: Set<string>, result: any[] = []): any[] {
  if (types.has(node?.type)) result.push(node);
  for (const child of node?.content ?? []) nodesOfType(child, types, result);
  return result;
}

async function createPage(admin: APIRequestContext, spaceId: string, title: string, content: JsonRecord) {
  const created = (await api<any>(admin, "POST", "/api/pages", { spaceId, title, content, format: "json" })).payload;
  await api(admin, "POST", "/api/pages/actions/update", {
    pageId: created.id,
    content,
    format: "json",
    operation: "replace",
  });
  return created;
}

async function pageInfo(context: APIRequestContext, pageId: string) {
  return (await api<any>(context, "GET", `/api/pages/info?pageId=${pageId}`)).payload;
}

async function stablePageInfo(context: APIRequestContext, pageId: string) {
  return waitFor("stable persisted page content", async () => {
    const first = await pageInfo(context, pageId);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const second = await pageInfo(context, pageId);
    return canonicalHash(first.content) === canonicalHash(second.content)
      ? second
      : undefined;
  }, 20_000);
}

function pageUrl(space: any, page: any): string {
  const slug = String(page.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `/s/${space.slug}/p/${slug}-${page.slugId}`;
}

async function contextRevision(context: APIRequestContext, conversationId: string): Promise<number> {
  const current = (await api<any>(context, "GET", `/api/ai/conversations/${conversationId}/context`)).payload;
  return current.revision;
}

async function startRun(context: APIRequestContext, pageId: string, scenario: string, agentMode = true) {
  const conversation = (await api<any>(context, "POST", "/api/ai/conversations", {
    pageId,
    clientRequestId: randomUUID(),
    title: `Agent audit ${scenario}`,
    useSpaceSearch: false,
    agentMode,
  })).payload;
  const revision = await contextRevision(context, conversation.id);
  const marker = `AGENT_AUDIT:${scenario}`;
  const sent = (await api<any>(context, "POST", `/api/ai/conversations/${conversation.id}/messages`, {
    content: marker,
    clientRequestId: randomUUID(),
    contextRevision: revision,
    documentSnapshot: marker,
    snapshotHash: createHash("sha256").update(marker).digest("hex"),
    documentHeadings: [],
    useSpaceSearch: false,
  })).payload;
  transitionJournal.push({ at: new Date().toISOString(), scenario, runId: sent.run.id, status: sent.run.status });
  return { conversation, ...sent };
}

async function runState(context: APIRequestContext, runId: string) {
  return (await api<any>(context, "GET", `/api/ai/runs/${runId}`)).payload;
}

async function waitRun(context: APIRequestContext, runId: string, statuses: string[], timeoutMs = 90_000) {
  return waitFor(`run ${runId} -> ${statuses.join("|")}`, async () => {
    const run = await runState(context, runId);
    if (!statuses.includes(run.status)) return undefined;
    transitionJournal.push({ at: new Date().toISOString(), runId, status: run.status, errorCode: run.errorCode ?? null });
    return run;
  }, timeoutMs);
}

function pendingApproval(run: any) {
  return run.steps?.find((step: any) => step.status === "pending_approval");
}

async function openAssistant(page: Page, url: string) {
  await page.goto(url);
  const composer = page.locator('[role="textbox"][aria-label*="Ask about"], [role="textbox"][aria-label*="Спросите"]');
  const aside = page.locator("#docmost-context-aside");
  const button = page.getByRole("button", { name: /Open AI assistant|Открыть AI-помощника/i });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const asideHidden =
      (await aside.count()) === 0 ||
      (await aside.getAttribute("aria-hidden").catch(() => "true")) === "true";
    if (!asideHidden) break;
    await button.click();
    await page.waitForTimeout(500);
  }
  await expect(aside).toBeVisible();
  await expect(aside).not.toHaveAttribute("aria-hidden", "true");
  await expect(composer).toBeVisible();
}

async function exposeConversation(context: APIRequestContext, conversationId: string) {
  await api(context, "POST", `/api/ai/conversations/${conversationId}/actions/open`, {});
}

async function modelRequests(): Promise<any[]> {
  const response = await fetch(`${modelControlUrl}/__requests`);
  if (!response.ok) throw new Error(`model request log returned ${response.status}`);
  return (await response.json()).requests;
}

async function waitModelScenario(scenario: string, before: number) {
  return waitFor(`provider scenario ${scenario}`, async () => {
    const entries = await modelRequests();
    return entries.slice(before).find((entry) => entry.scenario === scenario);
  });
}

async function configureScenario(name: string, value: { delayMs?: number; disconnect?: boolean }) {
  const response = await fetch(`${modelControlUrl}/__scenario`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, ...value }),
  });
  if (!response.ok) throw new Error(`scenario configuration returned ${response.status}`);
}

async function setProxy(name: "postgres" | "redis", enabled: boolean) {
  const response = await fetch(`${toxiproxyUrl}/proxies/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) throw new Error(`Toxiproxy ${name} update returned ${response.status}`);
  transitionJournal.push({
    at: new Date().toISOString(),
    fault: name,
    enabled,
  });
}

function compose(...args: string[]) {
  if (!composeProject) throw new Error("DOCMOST_AI_AGENT_COMPOSE_PROJECT is required");
  const command = [
    "compose",
    "-p",
    composeProject,
    ...composeFiles.flatMap((file) => ["-f", file]),
    ...args,
  ];
  const result = spawnSync("docker", command, { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`docker ${command.join(" ")} failed: ${(result.stderr || result.stdout).slice(0, 1000)}`);
  return result.stdout.trim();
}

function sql(statement: string): string {
  if (/[^\x20-\x7e]/.test(statement)) throw new Error("SQL audit command must be ASCII");
  return compose("exec", "-T", "db", "psql", "-U", "docmost", "-d", "docmost", "-Atc", statement);
}

async function waitHealth(timeoutMs = 120_000) {
  return waitFor("Docmost health", async () => fetch(`${baseURL}/api/health`).then((response) => response.ok).catch(() => false), timeoutMs);
}

async function capture(page: Page, name: string) {
  await fs.mkdir(path.join(auditRoot, "screenshots"), { recursive: true });
  await page.screenshot({ path: path.join(auditRoot, "screenshots", `${name}.png`), fullPage: true });
}

test("bounded agent mode lifecycle, concurrency, recovery, policies, limits and faults", async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  const admin = await adminApi();
  const adminContext = await browser.newContext({ baseURL, storageState: adminStorageState(), locale: "en-US" });
  const adminPage = await adminContext.newPage();
  let memberContext: BrowserContext | undefined;
  let memberApiContext: APIRequestContext | undefined;
  let memberId = "";

  try {
    const workspace = (await api<any>(admin, "GET", "/api/workspace/info")).payload;
    const runId = required("DOCMOST_AI_AGENT_RUN_ID");
    const email = `ai-agent-${runId}@example.com`;
    const memberPassword = `Audit-${randomUUID()}-Aa1!`;
    await api(admin, "POST", "/api/workspace/invites/create", { emails: [email], groupIds: [], role: "member" });
    const invitations = (await api<any>(admin, "GET", "/api/workspace/invites?limit=100")).payload;
    const invitation = (invitations.items ?? invitations).find((item: any) => item.email === email);
    expect(invitation?.id).toBeTruthy();
    const inviteLink = (await api<any>(admin, "POST", "/api/workspace/invites/link", { invitationId: invitation.id })).payload.inviteLink;
    const inviteUrl = new URL(inviteLink, baseURL);
    memberContext = await browser.newContext({ baseURL, locale: "en-US" });
    const accepted = await memberContext.request.post("/api/workspace/invites/accept", {
      data: {
        invitationId: inviteUrl.searchParams.get("invitationId") ?? inviteUrl.pathname.split("/").filter(Boolean).at(-1),
        token: inviteUrl.searchParams.get("token"),
        name: "AI Agent Audit Writer",
        password: memberPassword,
      },
      headers: { Origin: origin, Referer: `${origin}/` },
    });
    expect(accepted.ok()).toBeTruthy();
    const memberInfo = unwrap<any>(await (await memberContext.request.get("/api/users/me")).json());
    memberId = memberInfo.user.id;
    const memberStorage = await memberContext.storageState();
    const memberCsrf = memberStorage.cookies.find((cookie) => cookie.name === "csrfToken")?.value;
    expect(memberCsrf).toBeTruthy();
    memberApiContext = await request.newContext({
      baseURL,
      storageState: memberStorage,
      extraHTTPHeaders: {
        Origin: origin,
        Referer: `${origin}/`,
        "x-csrf-token": memberCsrf!,
        Accept: "application/json",
      },
    });

    const space = (await api<any>(admin, "POST", "/api/spaces", {
      name: `AI agent audit ${runId}`,
      slug: `aiagent${runId.replace(/[^a-z0-9]/gi, "").slice(-14)}`,
      description: "Isolated deterministic Agent mode audit.",
    })).payload;
    await api(admin, "POST", "/api/spaces/members/add", {
      spaceId: space.id,
      role: "writer",
      userIds: [memberId],
      groupIds: [],
    });

    const providerUrl = required("DOCMOST_AI_AGENT_MODEL_PROVIDER_URL");
    const providerConfig = {
      enabled: true,
      agentEnabled: false,
      provider: "openai-compatible",
      baseUrl: providerUrl,
      chatModel: "docmost-agent-audit-v1",
      apiKey: required("DOCMOST_AI_AGENT_CANARY"),
      temperature: 0,
      maxOutputTokens: 512,
      contextWindow: 8192,
      requestTimeoutMs: 30_000,
      reasoningEnabled: false,
      visionEnabled: false,
      retrieval: { adapter: "none", url: null },
    };
    await api(admin, "PATCH", `/api/spaces/${space.id}/ai/config`, providerConfig);
    const complex = complexDocument(`COMPLEX_${runId}`);
    const page = await createPage(admin, space.id, "Agent complex document", complex);
    const url = pageUrl(space, page);
    await openAssistant(adminPage, url);
    await expect(adminPage.getByRole("radio", { name: /^Agent$/i })).toHaveCount(0);
    await api(admin, "POST", `/api/spaces/${space.id}/ai/config/actions/test-agent`, {});
    await api(admin, "PATCH", `/api/spaces/${space.id}/ai/config`, { agentEnabled: true });

    const workspacePolicy = (await api<any>(admin, "GET", "/api/ai/tool-policy")).payload;
    await Promise.all([
      openAssistant(adminPage, url),
      memberContext.newPage().then((memberPage) => memberPage.goto(url)),
    ]);
    await expect(adminPage.getByRole("radio", { name: /^Agent$/i })).toBeEnabled();
    const liveEditor = adminPage
      .locator('.ProseMirror[aria-label="Editor"], .ProseMirror[aria-label="Редактор"]')
      .first();
    await expect(liveEditor).toContainText(`COMPLEX_${runId}`, { timeout: 20_000 });

    const chatBefore = (await modelRequests()).length;
    const chat = await startRun(admin, page.id, "chat-mode", false);
    const chatDone = await waitRun(admin, chat.run.id, ["completed"]);
    expect(chatDone.executionMode).toBe("chat");
    const chatRequest = await waitModelScenario("chat-mode", chatBefore);
    expect(chatRequest.hasTools).toBe(false);

    const beforeSuccess = await stablePageInfo(admin, page.id);
    const unsupportedBefore = nodesOfType(beforeSuccess.content, new Set(["table", "codeBlock", "embed", "transclusionSource"]));
    const success = await startRun(admin, page.id, "success");
    const awaiting = await waitRun(admin, success.run.id, ["awaiting_approval"]);
    const approval = pendingApproval(awaiting);
    const outlineStep = awaiting.steps.find(
      (step: any) => step.toolName === "getOutline" && step.status === "completed",
    );
    expect(approval?.toolName).toBe("editPageText");
    expect(outlineStep?.result?.contentHash).toBe(approval.baseContentHash);
    expect(await liveEditor.textContent()).not.toContain("[agent audit approved]");
    expect(textOf((await stablePageInfo(admin, page.id)).content)).not.toContain("[agent audit approved]");
    await exposeConversation(admin, success.conversation.id);
    await adminPage.reload();
    await openAssistant(adminPage, url);
    const approve = adminPage.getByRole("button", { name: /Approve|Одобрить/i });
    await expect(approve).toBeVisible();
    await capture(adminPage, "01-pending-approval");
    await approve.focus();
    await expect(approve).toBeFocused();
    await adminPage.keyboard.press("Enter");
    const successDone = await waitRun(admin, success.run.id, ["completed"]);
    const writeSteps = successDone.steps.filter((step: any) => step.writeClass === "write");
    expect(writeSteps).toHaveLength(1);
    expect(writeSteps[0].status).toBe("approved");
    expect(writeSteps[0].result).toMatchObject({ ok: true, applied: true });
    const duplicate = await api(admin, "POST", `/api/ai/runs/${success.run.id}/steps/${approval.id}/actions/approve`, {}, true);
    expect(duplicate.status).toBe(409);
    const afterSuccess = await waitFor("persisted approved page content", async () => {
      const value = await pageInfo(admin, page.id);
      return textOf(value.content).includes("[agent audit approved]") ? value : undefined;
    });
    expect((textOf(afterSuccess.content).match(/\[agent audit approved\]/g) ?? [])).toHaveLength(1);
    const unsupportedAfter = nodesOfType(afterSuccess.content, new Set(["table", "codeBlock", "embed", "transclusionSource"]));
    expect(unsupportedAfter).toEqual(unsupportedBefore);
    await capture(adminPage, "02-approved-once");

    const rejectBefore = canonicalHash(afterSuccess.content);
    const rejected = await startRun(admin, page.id, "reject");
    const rejectedAwaiting = await waitRun(admin, rejected.run.id, ["awaiting_approval"]);
    await exposeConversation(admin, rejected.conversation.id);
    await adminPage.reload();
    await openAssistant(adminPage, url);
    await adminPage.getByRole("button", { name: /Reject|Отклонить/i }).click();
    const rejectedDone = await waitRun(admin, rejected.run.id, ["completed"]);
    const rejectedWrite = rejectedDone.steps.find((step: any) => step.writeClass === "write");
    expect(rejectedWrite).toMatchObject({
      status: "rejected",
      errorCode: "agent_write_rejected",
      result: expect.objectContaining({ applied: false }),
    });
    expect(canonicalHash((await pageInfo(admin, page.id)).content)).toBe(rejectBefore);
    expect(pendingApproval(rejectedAwaiting)?.status).toBe("pending_approval");

    const expired = await startRun(admin, page.id, "expired");
    const expiredAwaiting = await waitRun(admin, expired.run.id, ["awaiting_approval"]);
    const expiredStep = pendingApproval(expiredAwaiting);
    sql(`update ai_run_steps set expires_at=now()-interval '1 minute' where id='${expiredStep.id}'`);
    const expiredDecision = await api(admin, "POST", `/api/ai/runs/${expired.run.id}/steps/${expiredStep.id}/actions/approve`, {}, true);
    expect(expiredDecision.status).toBe(409);
    expect(expiredDecision.payload.code).toBe("agent_write_expired");
    const expiredDone = await waitRun(admin, expired.run.id, ["completed"]);
    expect(expiredDone.steps.find((step: any) => step.writeClass === "write")).toMatchObject({
      status: "expired",
      errorCode: "agent_write_expired",
    });

    const cancelled = await startRun(admin, page.id, "cancel");
    const cancelledAwaiting = await waitRun(admin, cancelled.run.id, ["awaiting_approval"]);
    const cancelledStep = pendingApproval(cancelledAwaiting);
    await api(admin, "POST", `/api/ai/runs/${cancelled.run.id}/actions/cancel`, {});
    const cancelledDone = await waitRun(admin, cancelled.run.id, ["cancelled"]);
    expect(cancelledDone.steps.find((step: any) => step.id === cancelledStep.id)).toMatchObject({
      status: "expired",
      errorCode: "cancelled",
    });
    expect(canonicalHash((await pageInfo(admin, page.id)).content)).toBe(rejectBefore);

    const stalePage = await createPage(admin, space.id, "Agent stale document", { type: "doc", content: [paragraph(`STALE_${runId}`)] });
    const staleUrl = pageUrl(space, stalePage);
    const stale = await startRun(admin, stalePage.id, "stale");
    const staleAwaiting = await waitRun(admin, stale.run.id, ["awaiting_approval"]);
    const staleStep = pendingApproval(staleAwaiting);
    const memberPage = await memberContext.newPage();
    await memberPage.goto(staleUrl);
    const memberEditor = memberPage
      .locator('.ProseMirror[aria-label="Editor"], .ProseMirror[aria-label="Редактор"]')
      .first();
    await expect(memberEditor).toContainText(`STALE_${runId}`);
    if ((await memberEditor.getAttribute("contenteditable")) !== "true") {
      await memberPage.getByRole("radiogroup").getByText(/Edit|Редактировать/i).click();
    }
    await expect(memberEditor).toHaveAttribute("contenteditable", "true");
    await memberEditor.fill(`STALE_${runId} concurrent-writer-change`);
    await expect(memberEditor).toContainText("concurrent-writer-change");
    await waitFor("concurrent writer change to persist", async () =>
      textOf((await pageInfo(admin, stalePage.id)).content).includes("concurrent-writer-change"),
    );
    const staleDecision = await api(admin, "POST", `/api/ai/runs/${stale.run.id}/steps/${staleStep.id}/actions/approve`, {}, true);
    expect(staleDecision.ok).toBe(true);
    const staleDone = await waitRun(admin, stale.run.id, ["completed"]);
    expect(staleDone.steps.find((step: any) => step.writeClass === "write")).toMatchObject({
      status: "failed",
      errorCode: "agent_write_stale",
      result: expect.objectContaining({ applied: false }),
    });
    await memberPage.close();

    const ownedByMember = await startRun(memberApiContext, stalePage.id, "wrong-user");
    const memberAwaiting = await waitRun(memberApiContext, ownedByMember.run.id, ["awaiting_approval"]);
    const memberStep = pendingApproval(memberAwaiting);
    const wrongUser = await api(admin, "POST", `/api/ai/runs/${ownedByMember.run.id}/steps/${memberStep.id}/actions/approve`, {}, true);
    expect(wrongUser.status).toBe(404);
    await api(admin, "POST", "/api/spaces/members/change-role", { spaceId: space.id, userId: memberId, role: "reader" });
    const revokedDecision = await api(memberApiContext, "POST", `/api/ai/runs/${ownedByMember.run.id}/steps/${memberStep.id}/actions/approve`, {}, true);
    expect(revokedDecision.ok).toBe(true);
    const revokedDone = await waitRun(memberApiContext, ownedByMember.run.id, ["completed"]);
    expect(revokedDone.steps.find((step: any) => step.writeClass === "write")).toMatchObject({
      status: "failed",
      errorCode: "agent_write_not_allowed",
      result: expect.objectContaining({ applied: false }),
    });
    const viewerBeforeHash = canonicalHash((await pageInfo(admin, stalePage.id)).content);
    const viewerRun = await startRun(memberApiContext, stalePage.id, "viewer-read-only");
    const viewerDone = await waitRun(memberApiContext, viewerRun.run.id, ["completed"]);
    expect(viewerDone.steps.some((step: any) => step.status === "pending_approval")).toBe(false);
    expect(viewerDone.steps.find((step: any) => step.writeClass === "write")).toMatchObject({
      status: "failed",
      errorCode: "agent_tool_call_invalid",
    });
    expect(canonicalHash((await pageInfo(admin, stalePage.id)).content)).toBe(viewerBeforeHash);
    await api(admin, "POST", "/api/spaces/members/change-role", { spaceId: space.id, userId: memberId, role: "writer" });

    const recoveryPage = await createPage(admin, space.id, "Agent recovery document", { type: "doc", content: [paragraph(`RECOVERY_${runId}`)] });
    const recoveryUrl = pageUrl(space, recoveryPage);
    const recovery = await startRun(admin, recoveryPage.id, "restart-recovery");
    const recoveryAwaiting = await waitRun(admin, recovery.run.id, ["awaiting_approval"]);
    const recoveryStep = pendingApproval(recoveryAwaiting);
    await exposeConversation(admin, recovery.conversation.id);
    const restoredTab = await adminContext.newPage();
    await openAssistant(restoredTab, recoveryUrl);
    await expect(restoredTab.getByRole("button", { name: /Approve|Одобрить/i })).toBeVisible();
    await restoredTab.close();
    compose("restart", "docmost");
    await waitHealth();
    const afterRestart = await runState(admin, recovery.run.id);
    expect(afterRestart.status).toBe("awaiting_approval");
    await api(admin, "POST", `/api/ai/runs/${recovery.run.id}/steps/${recoveryStep.id}/actions/approve`, {});
    await waitRun(admin, recovery.run.id, ["completed"]);

    const parallelPage = await createPage(admin, space.id, "Parallel proposals document", { type: "doc", content: [paragraph(`PARALLEL_${runId}`)] });
    const [parallelA, parallelB] = await Promise.all([
      startRun(admin, parallelPage.id, "parallel-a"),
      startRun(admin, parallelPage.id, "parallel-b"),
    ]);
    const [parallelAwaitingA, parallelAwaitingB] = await Promise.all([
      waitRun(admin, parallelA.run.id, ["awaiting_approval"]),
      waitRun(admin, parallelB.run.id, ["awaiting_approval"]),
    ]);
    const parallelStepA = pendingApproval(parallelAwaitingA);
    const parallelStepB = pendingApproval(parallelAwaitingB);
    expect(parallelStepA.baseContentHash).toBe(parallelStepB.baseContentHash);
    await api(admin, "POST", `/api/ai/runs/${parallelA.run.id}/steps/${parallelStepA.id}/actions/approve`, {});
    await waitRun(admin, parallelA.run.id, ["completed"]);
    const parallelSecond = await api(admin, "POST", `/api/ai/runs/${parallelB.run.id}/steps/${parallelStepB.id}/actions/approve`, {}, true);
    expect(parallelSecond.ok).toBe(true);
    const parallelSecondDone = await waitRun(admin, parallelB.run.id, ["completed"]);
    expect(parallelSecondDone.steps.find((step: any) => step.writeClass === "write")).toMatchObject({
      status: "failed",
      errorCode: "agent_write_stale",
    });

    await api(admin, "PUT", `/api/spaces/${space.id}/ai/tool-policy`, { allowedCapabilities: ["page.outline.read"] });
    const narrowedBefore = (await modelRequests()).length;
    const narrowed = await startRun(admin, page.id, "space-narrowing");
    await waitRun(admin, narrowed.run.id, ["completed"]);
    const narrowedRequest = await waitModelScenario("space-narrowing", narrowedBefore);
    expect(narrowedRequest.toolNames).toContain("getOutline");
    expect(narrowedRequest.toolNames).not.toContain("editPageText");
    await api(admin, "PUT", `/api/spaces/${space.id}/ai/tool-policy`, { allowedCapabilities: null });

    await configureScenario("policy-change", { delayMs: 1500 });
    const policyBefore = (await modelRequests()).length;
    const policyRun = await startRun(admin, page.id, "policy-change");
    await waitModelScenario("policy-change", policyBefore);
    await api(admin, "PATCH", "/api/ai/tool-policy", {
      enabled: false,
      allowedCapabilities: workspacePolicy.allowedCapabilities,
    });
    const policyFailed = await waitRun(admin, policyRun.run.id, ["failed"]);
    expect(policyFailed.errorCode).toBe("agent_tool_policy_changed");
    await api(admin, "PATCH", "/api/ai/tool-policy", {
      enabled: true,
      allowedCapabilities: workspacePolicy.allowedCapabilities,
    });
    await configureScenario("policy-change", { delayMs: 0 });

    const stepLimit = await startRun(admin, page.id, "step-limit");
    expect((await waitRun(admin, stepLimit.run.id, ["failed"])).errorCode).toBe("agent_step_limit");
    const toolLimit = await startRun(admin, page.id, "tool-limit");
    expect((await waitRun(admin, toolLimit.run.id, ["failed"])).errorCode).toBe("agent_tool_limit");
    const largePage = await createPage(admin, space.id, "Agent result limit document", {
      type: "doc",
      content: [paragraph(`RESULT_${runId} ${"x".repeat(90_000)}`)],
    });
    const resultLimit = await startRun(admin, largePage.id, "result-limit");
    const resultLimitDone = await waitRun(admin, resultLimit.run.id, ["failed"]);
    expect(resultLimitDone.errorCode).toBe("agent_result_limit");

    const redisConversation = (await api<any>(admin, "POST", "/api/ai/conversations", {
      pageId: page.id,
      clientRequestId: randomUUID(),
      title: "Redis durable queue recovery",
      agentMode: false,
    })).payload;
    const redisRevision = await contextRevision(admin, redisConversation.id);
    await setProxy("redis", false);
    const redisSent = (await api<any>(admin, "POST", `/api/ai/conversations/${redisConversation.id}/messages`, {
      content: "AGENT_AUDIT:redis-recovery",
      clientRequestId: randomUUID(),
      contextRevision: redisRevision,
      documentSnapshot: "redis recovery",
      snapshotHash: createHash("sha256").update("redis recovery").digest("hex"),
      documentHeadings: [],
      useSpaceSearch: false,
    })).payload;
    expect(redisSent.run.status).toBe("queued");
    await setProxy("redis", true);
    const redisRecovered = await waitRun(admin, redisSent.run.id, ["completed"], 120_000);
    expect(redisRecovered.status).toBe("completed");

    const postgresFault = await startRun(admin, page.id, "postgres-fault");
    const postgresAwaiting = await waitRun(admin, postgresFault.run.id, ["awaiting_approval"]);
    const postgresStep = pendingApproval(postgresAwaiting);
    await setProxy("postgres", false);
    await api(admin, "POST", `/api/ai/runs/${postgresFault.run.id}/steps/${postgresStep.id}/actions/approve`, {}, true).catch(() => undefined);
    await setProxy("postgres", true);
    await waitHealth();
    expect((await runState(admin, postgresFault.run.id)).status).toBe("awaiting_approval");
    await api(admin, "POST", `/api/ai/runs/${postgresFault.run.id}/steps/${postgresStep.id}/actions/reject`, {});
    const postgresDone = await waitRun(admin, postgresFault.run.id, ["completed"]);
    expect(postgresDone.steps.find((step: any) => step.writeClass === "write")).toMatchObject({
      status: "rejected",
      errorCode: "agent_write_rejected",
    });

    const dbCounts = JSON.parse(sql(`select json_build_object('runs',(select count(*) from ai_runs where workspace_id='${workspace.id}'),'steps',(select count(*) from ai_run_steps s join ai_runs r on r.id=s.run_id where r.workspace_id='${workspace.id}'))`));
    await fs.writeFile(path.join(auditRoot, "transition-journal.json"), `${JSON.stringify(transitionJournal, null, 2)}\n`);
    await fs.writeFile(path.join(auditRoot, "database-summary.json"), `${JSON.stringify({ workspaceId: workspace.id, counts: dbCounts }, null, 2)}\n`);
    await fs.writeFile(path.join(auditRoot, "browser-summary.json"), `${JSON.stringify({ contexts: 2, spaceId: space.id, pageIds: [page.id, stalePage.id, recoveryPage.id, parallelPage.id, largePage.id] }, null, 2)}\n`);
  } finally {
    await memberApiContext?.dispose().catch(() => undefined);
    await memberContext?.close().catch(() => undefined);
    await adminContext.close().catch(() => undefined);
    await admin.dispose().catch(() => undefined);
  }
});
