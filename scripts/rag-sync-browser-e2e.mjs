import { mkdir, writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const baseUrl = new URL(process.env.RAG_SYNC_E2E_BASE_URL ?? "http://127.0.0.1:3200");
const fixtureUrl = new URL(
  process.env.RAG_SYNC_E2E_FIXTURE_URL ?? "http://127.0.0.1:18081",
);
const outputDir = process.env.RAG_SYNC_E2E_OUTPUT ?? "output/audit/rag-sync-browser";
await mkdir(outputDir, { recursive: true });

function findObject(value, predicate) {
  if (value && typeof value === "object") {
    if (predicate(value)) return value;
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      const found = findObject(child, predicate);
      if (found) return found;
    }
  }
  return undefined;
}

class Session {
  cookie = "";
  csrf = "";

  collect(response) {
    const values = response.headers.getSetCookie?.() ?? [];
    const fallback = response.headers.get("set-cookie");
    const raw = values.length ? values : fallback ? fallback.split(/,(?=\s*\w+=)/) : [];
    const pairs = raw.map((value) => value.split(";", 1)[0]);
    this.cookie = pairs.join("; ");
    this.csrf = pairs.find((value) => value.startsWith("csrfToken="))?.slice(10) ?? "";
  }

  async api(path, { method = "GET", body, publicRequest = false } = {}) {
    const headers = { accept: "application/json" };
    if (!publicRequest) headers.cookie = this.cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET" && method !== "HEAD") {
      headers.origin = baseUrl.origin;
      if (!publicRequest) headers["x-csrf-token"] = this.csrf;
    }
    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : undefined;
    if (!response.ok) {
      throw new Error(`${method} ${path} returned ${response.status}: ${text.slice(0, 500)}`);
    }
    return { response, payload: payload?.data ?? payload };
  }
}

async function waitFor(description, predicate, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${description} timed out${last ? `: ${last.message}` : ""}`);
}

const admin = new Session();
const member = new Session();
const setup = await admin.api("api/auth/setup", {
  method: "POST",
  publicRequest: true,
  body: {
    name: "RAG Audit Admin",
    email: "rag-admin@example.test",
    password: "RAG-audit-admin-password-123!",
    workspaceName: "RAG Audit Workspace",
    hostname: `rag-audit-${Date.now()}`,
  },
});
admin.collect(setup.response);
const workspace = (await admin.api("api/workspace/info")).payload;
const workspaceId = workspace.id;

await admin.api("api/workspace/invites/create", {
  method: "POST",
  body: { emails: ["rag-member@example.test"], groupIds: [], role: "member" },
});
const pendingInvitations = (
  await admin.api("api/workspace/invites?limit=100")
).payload;
const invitation = findObject(
  pendingInvitations,
  (value) => value.email === "rag-member@example.test" && value.id,
);
if (!invitation?.id) throw new Error("Invitation creation omitted id");
const linkResponse = await admin.api("api/workspace/invites/link", {
  method: "POST",
  body: { invitationId: invitation.id },
});
const inviteUrl = new URL(linkResponse.payload.inviteLink, baseUrl);
const invitationId = inviteUrl.searchParams.get("invitationId") ?? invitation.id;
const invitationToken = inviteUrl.searchParams.get("token");
if (!invitationToken) throw new Error("Invitation link omitted token");
const accepted = await member.api("api/workspace/invites/accept", {
  method: "POST",
  publicRequest: true,
  body: {
    invitationId,
    token: invitationToken,
    name: "RAG Audit Member",
    password: "RAG-audit-member-password-123!",
  },
});
member.collect(accepted.response);
const members = (await admin.api("api/workspace/members?limit=100")).payload;
const memberEntity = findObject(
  members,
  (value) => value.email === "rag-member@example.test" && value.id,
);
if (!memberEntity?.id) throw new Error("Accepted member was not listed");

const spaceResponse = await admin.api("api/spaces", {
  method: "POST",
  body: { name: "RAG Browser Audit", slug: `ragbrowser${Date.now()}` },
});
const space = findObject(spaceResponse.payload, (value) => value.id && value.slug);
await admin.api("api/spaces/members/add", {
  method: "POST",
  body: { spaceId: space.id, role: "reader", userIds: [memberEntity.id], groupIds: [] },
});

async function createPage(title) {
  const result = await admin.api("api/pages", {
    method: "POST",
    body: {
      spaceId: space.id,
      title,
      format: "json",
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { id: "fixture-heading", level: 2 },
            content: [{ type: "text", text: "Fixture heading" }],
          },
          {
            type: "paragraph",
            attrs: { id: crypto.randomUUID() },
            content: [{ type: "text", text: "RAG browser sentinel 7ec93d21" }],
          },
        ],
      },
    },
  });
  return findObject(result.payload, (value) => value.id && value.spaceId === space.id);
}

const currentPage = await createPage("RAG current page");
const sourcePage = await createPage("RAG source page");
await writeFile(
  `${outputDir}/audit-state.json`,
  JSON.stringify(
    {
      baseUrl: baseUrl.origin,
      workspaceId,
      memberId: memberEntity.id,
      spaceId: space.id,
      currentPageId: currentPage.id,
      sourcePageId: sourcePage.id,
    },
    null,
    2,
  ),
);
await admin.api(`api/pages/${currentPage.id}/actions/access/grant-user`, {
  method: "POST",
  body: { userId: memberEntity.id, role: "writer" },
});
const grantSource = () =>
  admin.api(`api/pages/${sourcePage.id}/actions/access/grant-user`, {
    method: "POST",
    body: { userId: memberEntity.id, role: "reader" },
  });
const revokeSource = () =>
  admin.api(`api/pages/${sourcePage.id}/actions/access/close-user`, {
    method: "POST",
    body: { userId: memberEntity.id },
  });
await grantSource();

const metadata = {
  knowledge_id: "knowledge-one",
  docmost: {
    schemaVersion: 2,
    bindingId: crypto.randomUUID(),
    targetVersion: 1,
    workspaceId,
    spaceId: space.id,
    sourceType: "page",
    sourceId: sourcePage.id,
    pageId: sourcePage.id,
    sourceUpdatedAtMs: Date.now(),
    contentHash: "d".repeat(64),
    operationId: crypto.randomUUID(),
  },
};
const form = new FormData();
form.set("file", new Blob(["RAG browser sentinel 7ec93d21"]), "rag-source.md");
form.set("metadata", JSON.stringify(metadata));
const uploaded = await fetch(new URL("api/v1/files/", fixtureUrl), {
  method: "POST",
  headers: { authorization: "Bearer ci-writer-one" },
  body: form,
});
if (!uploaded.ok) throw new Error(`Fixture upload returned ${uploaded.status}`);

await admin.api(`api/spaces/${space.id}/ai/config`, {
  method: "PATCH",
  body: {
    enabled: true,
    provider: "openai-compatible",
    baseUrl: "http://toxiproxy:8666/v1",
    chatModel: "fixture-model",
    apiKey: "fixture-provider-key",
    retrieval: {
      adapter: "open-webui-knowledge-v1",
      timeoutMs: 5000,
      maxResults: 8,
      openWebUi: {
        baseUrl: "http://toxiproxy:8666",
        knowledgeId: "knowledge-one",
        apiKey: "ci-writer-one",
      },
    },
  },
});

async function createConversation() {
  return (
    await member.api("api/ai/conversations", {
      method: "POST",
      body: {
        pageId: currentPage.id,
        clientRequestId: crypto.randomUUID(),
        useSpaceSearch: true,
        agentMode: false,
      },
    })
  ).payload;
}

async function send(conversation) {
  return (
    await member.api(`api/ai/conversations/${conversation.id}/messages`, {
      method: "POST",
      body: {
        content: "What is the browser sentinel?",
        clientRequestId: crypto.randomUUID(),
        contextRevision: conversation.contextRevision,
        documentSnapshot: "RAG current page",
        snapshotHash: "e".repeat(64),
        documentHeadings: [],
        useSpaceSearch: true,
      },
    })
  ).payload;
}

const conversation = await createConversation();
const firstRun = await send(conversation);
let firstMessages;
try {
  await waitFor("first cited answer", async () => {
    const payload = (
      await member.api(`api/ai/conversations/${conversation.id}/messages?limit=50`)
    ).payload;
    firstMessages = payload.items ?? payload;
    return firstMessages.some(
      (message) =>
        message.id === firstRun.assistantMessage.id &&
        message.runStatus === "completed" &&
        message.content.includes("[C1]") &&
        message.sources?.length === 1,
    );
  }, 20_000);
} catch (error) {
  await writeFile(
    `${outputDir}/first-messages.json`,
    JSON.stringify({ firstRun, firstMessages }, null, 2),
  );
  throw error;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const cookies = member.cookie.split("; ").map((pair) => {
  const index = pair.indexOf("=");
  return {
    name: pair.slice(0, index),
    value: pair.slice(index + 1),
    url: baseUrl.origin,
  };
});
await context.addCookies(cookies);
const page = await context.newPage();
try {
  await page.goto(
    new URL(`/s/${space.slug}/p/${currentPage.slugId}`, baseUrl).toString(),
  );
  await page.getByRole("button", { name: "Open AI assistant" }).click();
  await page.getByText("Fixture answer supported by the synchronized source").waitFor();
  await page.getByRole("link", { name: /RAG source page|C1/ }).first().waitFor();
  await page.screenshot({ path: `${outputDir}/citation.png`, fullPage: true });

  const accessInvalidationReload = page.waitForNavigation({
    waitUntil: "domcontentloaded",
  });
  await revokeSource();
  await accessInvalidationReload;
  await page.getByRole("button", { name: "Open AI assistant" }).click();
  await page
    .getByText(
      "This message is hidden because you no longer have access to one or more of its sources.",
    )
    .waitFor();
  await page.screenshot({ path: `${outputDir}/restricted.png`, fullPage: true });

  await grantSource();
  await fetch(new URL("__control", fixtureUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fault: { operation: "provider", mode: "delayed_side_effect", delayMs: 1500, count: 1 },
    }),
  });
  const secondConversation = await createConversation();
  const stateBefore = await fetch(new URL("__state", fixtureUrl)).then((response) => response.json());
  const secondRun = await send(secondConversation);
  await waitFor("provider call to start", async () => {
    const state = await fetch(new URL("__state", fixtureUrl)).then((response) => response.json());
    return state.counters.providerRequests > stateBefore.counters.providerRequests;
  });
  await revokeSource();
  await waitFor("source-access failure", async () => {
    const messages = (
      await member.api(`api/ai/conversations/${secondConversation.id}/messages?limit=50`)
    ).payload.items;
    return messages.some(
      (message) =>
        message.id === secondRun.assistantMessage.id &&
        message.runStatus === "failed" &&
        message.errorCode === "source_access_changed" &&
        message.content === "" &&
        message.reasoning === "",
    );
  });
  const fixtureState = await fetch(new URL("__state", fixtureUrl)).then((response) => response.json());
  if (!fixtureState.files.some((file) => file.meta?.data?.docmost?.sourceId === sourcePage.id)) {
    throw new Error("Personal ACL revoke removed shared Knowledge content");
  }

  const adminContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const adminCookies = admin.cookie.split("; ").map((pair) => {
    const index = pair.indexOf("=");
    return {
      name: pair.slice(0, index),
      value: pair.slice(index + 1),
      url: baseUrl.origin,
    };
  });
  await adminContext.addCookies(adminCookies);
  const adminPage = await adminContext.newPage();
  const browserErrors = [];
  adminPage.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  adminPage.on("pageerror", (error) => browserErrors.push(error.message));

  const settingsUrl = new URL(
    `/settings/ai/spaces/${space.slug}`,
    baseUrl,
  ).toString();
  await Promise.all([adminPage.goto(settingsUrl), page.goto(settingsUrl)]);
  await page.getByText("No access", { exact: true }).waitFor();
  if (await page.getByText("Open WebUI writer API key").isVisible()) {
    throw new Error("A reader could open the RAG Sync settings UI");
  }
  let memberApiDenied = false;
  try {
    await member.api(`api/spaces/${space.id}/ai/rag-sync`);
  } catch (error) {
    memberApiDenied = String(error).includes("returned 403");
  }
  if (!memberApiDenied) {
    throw new Error(
      "A reader could bypass RAG Sync authorization through the API",
    );
  }
  await page.screenshot({
    path: `${outputDir}/rag-sync-member-denied.png`,
    fullPage: true,
  });

  await adminPage
    .getByRole("button", { name: "RAG synchronization", exact: true })
    .click();
  await adminPage
    .getByRole("heading", { name: "Open WebUI synchronization" })
    .waitFor();
  await adminPage
    .getByRole("textbox", { name: "Open WebUI base URL", exact: true })
    .fill("http://open-webui-fixture:8080");
  await adminPage
    .getByRole("textbox", { name: "Knowledge Base ID", exact: true })
    .fill("knowledge-two");
  await adminPage
    .getByRole("textbox", {
      name: "Open WebUI writer API key",
      exact: true,
    })
    .fill("ci-writer-two");
  await adminPage.getByRole("button", { name: "Save", exact: true }).click();
  await adminPage
    .getByText("RAG synchronization settings saved.", { exact: true })
    .waitFor();
  const keyInput = adminPage.getByRole("textbox", {
    name: "Open WebUI writer API key",
    exact: true,
  });
  if ((await keyInput.getAttribute("type")) !== "password") {
    throw new Error("Writer credential input was not password-protected");
  }
  if ((await keyInput.evaluate((element) => element.value)) !== "") {
    throw new Error("Writer credential remained in the browser after save");
  }
  if (
    (await adminPage.locator("body").textContent()).includes("ci-writer-two")
  ) {
    throw new Error("Writer credential was rendered back into the settings UI");
  }

  const enableButton = adminPage.getByRole("button", {
    name: "Enable synchronization",
    exact: true,
  });
  await adminPage
    .getByRole("alert")
    .filter({ hasText: "Test the target before enabling" })
    .waitFor();
  if (await enableButton.isEnabled()) {
    throw new Error(
      "Enable was available before the writer target passed Test",
    );
  }
  await adminPage.screenshot({
    path: `${outputDir}/rag-sync-untested.png`,
    fullPage: true,
  });

  await adminPage
    .getByRole("button", { name: "Test writer", exact: true })
    .click();
  await adminPage.getByText(/Writer test succeeded in \d+ ms\./).waitFor();
  await waitFor("tested target to become enableable", () =>
    enableButton.isEnabled(),
  );
  const axeResult = await new AxeBuilder({ page: adminPage })
    .include("form")
    .analyze();
  const severeAccessibilityViolations = axeResult.violations.filter(
    (violation) =>
      violation.impact === "critical" || violation.impact === "serious",
  );
  if (severeAccessibilityViolations.length > 0) {
    await writeFile(
      `${outputDir}/rag-sync-accessibility-violations.json`,
      JSON.stringify(severeAccessibilityViolations, null, 2),
    );
    await adminPage.screenshot({
      path: `${outputDir}/rag-sync-accessibility-failure.png`,
      fullPage: true,
    });
    throw new Error(
      `RAG Sync settings have serious accessibility violations: ${severeAccessibilityViolations
        .map((violation) => violation.id)
        .join(", ")}`,
    );
  }
  await adminPage.screenshot({
    path: `${outputDir}/rag-sync-tested-desktop.png`,
    fullPage: true,
  });

  await adminPage.setViewportSize({ width: 390, height: 844 });
  await adminPage
    .getByRole("navigation", { name: "Settings section" })
    .waitFor({ state: "hidden" });
  await waitFor("mobile sidebar transition", () =>
    adminPage.evaluate(() => {
      const sidebar = document.querySelector("#docmost-primary-sidebar");
      const rect = sidebar?.getBoundingClientRect();
      return !rect || rect.right <= 0;
    }),
  );
  const mobileLayout = await adminPage.evaluate(() => {
    const sidebar = document.querySelector("#docmost-primary-sidebar");
    const main = document.querySelector("#docmost-main-content");
    const sidebarRect = sidebar?.getBoundingClientRect();
    const mainRect = main?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      devicePixelRatio: window.devicePixelRatio,
      mobileMediaMatches: window.matchMedia("(max-width: 48em)").matches,
      documentWidth: document.documentElement.scrollWidth,
      sidebarAriaHidden: sidebar?.getAttribute("aria-hidden") ?? null,
      sidebarRect: sidebarRect
        ? { x: sidebarRect.x, width: sidebarRect.width }
        : null,
      mainRect: mainRect ? { x: mainRect.x, width: mainRect.width } : null,
    };
  });
  await writeFile(
    `${outputDir}/rag-sync-mobile-layout.json`,
    JSON.stringify(mobileLayout, null, 2),
  );
  const horizontalOverflow = await adminPage.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  if (horizontalOverflow) {
    throw new Error("RAG Sync settings overflow horizontally at 390px");
  }
  await adminPage.screenshot({
    path: `${outputDir}/rag-sync-tested-mobile.png`,
    fullPage: true,
  });
  await adminPage.setViewportSize({ width: 1440, height: 1000 });
  await enableButton.click();
  await adminPage.getByText("Enabled", { exact: true }).first().waitFor();
  await adminPage.screenshot({
    path: `${outputDir}/rag-sync-enabled.png`,
    fullPage: true,
  });

  if (browserErrors.length > 0) {
    throw new Error(`RAG Sync browser errors: ${browserErrors.join(" | ")}`);
  }
  await writeFile(
    `${outputDir}/rag-sync-ui-audit.json`,
    JSON.stringify(
      {
        roles: ["workspace owner", "space reader"],
        simultaneousBrowserContexts: 2,
        readerUiDenied: true,
        readerApiDenied: true,
        enableBlockedBeforeTest: true,
        enableAllowedAfterTest: true,
        secretRendered: false,
        horizontalOverflowAt390px: false,
        seriousAccessibilityViolations: [],
        browserErrors: [],
      },
      null,
      2,
    ),
  );
  await adminContext.close();
} finally {
  await browser.close();
}

process.stdout.write("Browser RAG citation and ACL-revocation flow passed\n");
