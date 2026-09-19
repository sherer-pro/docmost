import { test, expect, chromium, type Page } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000001";

async function expectContentToFit(page: Page) {
  const overflow = await page
    .locator("#docmost-main-content")
    .evaluate((main) =>
      Array.from(main.querySelectorAll("*"))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.width > 1 &&
            rect.height > 1 &&
            getComputedStyle(element).visibility !== "hidden" &&
            (rect.right > window.innerWidth + 1 || rect.left < -1)
          );
        })
        .map((element) => ({
          tag: element.tagName,
          text: element.textContent?.slice(0, 80),
          right: element.getBoundingClientRect().right,
          width: window.innerWidth,
        })),
    );
  expect(overflow).toEqual([]);
}

for (const locale of ["en-US", "ru-RU"]) {
  for (const theme of ["light", "dark"]) {
    test(`200% browser zoom ${locale} ${theme}`, async ({
      browserName,
    }, testInfo) => {
      expect(browserName).toBe("chromium");
      test.setTimeout(90_000);
      const extension = testInfo.outputPath("zoom-extension");
      await fs.mkdir(extension, { recursive: true });
      await fs.writeFile(
        path.join(extension, "manifest.json"),
        JSON.stringify({
          manifest_version: 3,
          name: "Local zoom acceptance",
          version: "1.0.0",
          permissions: ["tabs"],
          background: { service_worker: "worker.js" },
        }),
      );
      await fs.writeFile(
        path.join(extension, "worker.js"),
        "chrome.runtime.onInstalled.addListener(() => {});",
      );
      await fs.writeFile(
        path.join(extension, "control.html"),
        "<!doctype html><title>Local zoom acceptance</title>",
      );
      const context = await chromium.launchPersistentContext(
        testInfo.outputPath("profile"),
        {
          baseURL: process.env.SPACES_ADMIN_BASE_URL,
          ignoreDefaultArgs: ["--disable-extensions"],
          channel: "chromium",
          headless: true,
          viewport: { width: 1440, height: 1000 },
          args: [
            `--disable-extensions-except=${extension}`,
            `--load-extension=${extension}`,
          ],
        },
      );
      try {
        const worker =
          context.serviceWorkers()[0] ??
          (await context.waitForEvent("serviceworker", { timeout: 10_000 }));
        const control = await context.newPage();
        await control.goto(new URL("control.html", worker.url()).href);
        const page = await context.newPage();
        await fixture(page, locale, theme);
        await page.goto("/settings/spaces");
        const zoom = await control.evaluate(async () => {
          const browserApi = (globalThis as any).chrome;
          const tabs = await browserApi.tabs.query({
            url: "http://127.0.0.1:5193/*",
          });
          await browserApi.tabs.setZoom(tabs[0].id, 2);
          return browserApi.tabs.getZoom(tabs[0].id);
        });
        expect(zoom).toBe(2);
        await expect
          .poll(() => page.evaluate(() => window.innerWidth))
          .toBe(720);
        for (const section of [
          "",
          "/space1/general",
          "/space1/members",
          "/space1/access",
          "/space1/documents",
          "/space1/templates",
          "/space1/navigation",
          "/space1/ai",
          "/space1/maintenance",
        ]) {
          await page.goto(`/settings/spaces${section}`);
          await expect(
            page.locator("main").getByRole("heading").first(),
          ).toBeVisible();
          await expect(
            page.locator("main").locator(".mantine-Loader-root"),
          ).toHaveCount(0);
          await expect(page.getByTestId("route-error")).toHaveCount(0);
          expect(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth <= window.innerWidth + 1,
            ),
          ).toBe(true);
          await expectContentToFit(page);
        }
        await page.goto("/settings/workspace");
        await expect(
          page.locator("main").getByRole("heading").first(),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        ).toBe(true);
        await expectContentToFit(page);
        await page.screenshot({
          path: testInfo.outputPath(`zoom-200-${locale}-${theme}.png`),
        });
      } finally {
        await context.close();
      }
    });
  }
}
async function fixture(
  page: Page,
  locale = "en-US",
  theme = "light",
  role = "admin",
) {
  const spaces = Array.from({ length: 43 }, (_, index) => ({
    id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    workspaceId,
    name: `Space ${String(index + 1).padStart(2, "0")}`,
    slug: `space${index + 1}`,
    description:
      index === 42
        ? "Hidden research project"
        : "Documentation and team collaboration",
    memberCount: index + 1,
    logo: null,
    archivedAt: index === 41 ? "2026-01-01T00:00:00.000Z" : null,
    settings: {},
    membership: { role: "admin", permissions: [] },
    policy: {
      overrides: {
        enforceMfa: null,
        enforceSso: null,
        disablePublicSharing: null,
      },
      effective: {
        enforceMfa: false,
        enforceSso: false,
        disablePublicSharing: false,
      },
    },
  }));
  const workspace: any = {
    id: workspaceId,
    name: "Test workspace",
    settings: {},
    pageHistoryRetentionDays: null,
    enforceMfa: false,
    enforceSso: false,
  };
  const policy: any = {
    spaceId: spaces[0].id,
    systemEnabled: true,
    workspaceEnabled: true,
    templatesEnabled: false,
    allowCreateTemplate: true,
    allowRegularTemplate: true,
    allowSyncedTemplate: true,
    revision: 1,
  };
  const groupPolicy: any = {
    spaceId: spaces[0].id,
    groupId: "group1",
    allowedActions: null,
    revision: 1,
  };
  const writes: any[] = [];
  const user = {
    id: userId,
    name: "Test administrator",
    email: "admin@example.invalid",
    role,
    locale,
    settings: { preferences: {} },
  };
  let fail = false;
  let failReads = false;
  const meta = {
    limit: 20,
    hasPrevPage: false,
    hasNextPage: false,
    prevCursor: null,
    nextCursor: null,
  };
  await page.routeWebSocket("**/socket.io/**", (socket) => socket.close());
  await page.addInitScript(
    ({ theme }) => {
      localStorage.setItem("mantine-color-scheme-value", theme);
      window.CONFIG = { CLOUD: "false", COLLAB_URL: location.origin };
    },
    { theme },
  );
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname.replace(/^\/api/, "");
    const ok = (data: any, status = 200) =>
      route.fulfill({ status, json: { data, success: status < 400, status } });
    if (pathname === "/version")
      return ok({ currentVersion: "1.3.0", latestVersion: "1.3.0" });
    if (pathname === "/labels/registry") return ok({ items: [], meta });
    if (request.method() !== "GET") {
      const body = request.postDataJSON();
      if (pathname === "/users/update") {
        Object.assign(user, body);
        return ok(user);
      }
      writes.push({ path: pathname, body });
      if (fail) {
        fail = false;
        return route.fulfill({
          status: 500,
          json: { message: "Temporary test failure" },
        });
      }
      if (pathname === "/workspace/update") {
        Object.assign(workspace, body);
        return ok(workspace);
      }
      if (pathname === "/spaces" && request.method() === "POST") {
        const space = {
          ...spaces[0],
          ...body,
          id: "30000000-0000-4000-8000-000000000099",
          settings: {},
          memberCount: 1,
        };
        spaces.push(space);
        return ok(space);
      }
      if (/^\/spaces\/[^/]+$/.test(pathname) && request.method() === "PATCH") {
        const space = spaces.find((space) => pathname.endsWith(space.id))!;
        for (const key of ["name", "description", "slug"])
          if (body[key] !== undefined) space[key] = body[key];
        if (body.dictionaryEnabled !== undefined)
          space.settings = {
            ...space.settings,
            dictionary: { enabled: body.dictionaryEnabled },
          };
        if (body.customLinks)
          space.settings = { ...space.settings, customLinks: body.customLinks };
        if (body.documentFields)
          space.settings = {
            ...space.settings,
            documentFields: body.documentFields,
          };
        for (const key of [
          "enforceMfa",
          "enforceSso",
          "disablePublicSharing",
        ] as const) {
          if (body[key] !== undefined) {
            space.policy.overrides[key] = body[key];
            space.policy.effective[key] = body[key] ?? false;
          }
        }
        return ok(space);
      }
      if (pathname.includes("/templates/policies/spaces/")) {
        const target = pathname.includes("/groups/") ? groupPolicy : policy;
        if (body.expectedRevision !== target.revision)
          return route.fulfill({
            status: 409,
            json: { message: "Policy conflict" },
          });
        Object.assign(target, body, { revision: target.revision + 1 });
        return ok(target);
      }
      return ok({});
    }
    if (pathname === "/users/me")
      return ok({
        user,
        workspace,
        authenticationAssurance: {
          ssoVerified: true,
          mfaVerified: true,
          workspaceMissingRequirements: [],
        },
      });
    if (pathname === "/spaces/administration") {
      if (failReads)
        return route.fulfill({
          status: 503,
          json: { message: "Temporary test failure" },
        });
      const query = (url.searchParams.get("query") ?? "").toLowerCase();
      const status = url.searchParams.get("status");
      const filtered = spaces.filter(
        (space) =>
          (!query ||
            `${space.name} ${space.description} ${space.slug}`
              .toLowerCase()
              .includes(query)) &&
          (status === "all" ||
            (status === "archived" ? space.archivedAt : !space.archivedAt)),
      );
      const start = url.searchParams.has("beforeCursor")
        ? Math.max(0, Number(url.searchParams.get("beforeCursor")) - 20)
        : Number(url.searchParams.get("cursor") ?? 0);
      const items = filtered.slice(start, start + 20).map((space) => ({
        ...space,
        requiresStepUp: false,
        canManage: role === "admin",
        access: space.policy.effective,
        features: {
          dictionary: false,
          templates: "disabled",
          ai: "not_configured",
        },
      }));
      return ok({
        items,
        meta: {
          limit: 20,
          hasPrevPage: start > 0,
          hasNextPage: start + 20 < filtered.length,
          prevCursor: start > 0 ? String(start) : null,
          nextCursor: start + 20 < filtered.length ? String(start + 20) : null,
        },
      });
    }
    if (pathname === "/spaces") return ok({ items: spaces, meta });
    if (pathname === "/spaces/members") return ok({ items: [], meta });
    if (pathname === "/spaces/policy-context") {
      const space =
        spaces.find(
          (space) => space.slug === url.searchParams.get("spaceSlug"),
        ) ?? spaces[0];
      return ok({
        id: space.id,
        slug: space.slug,
        name: space.name,
        policy: space.policy,
        requiresStepUp: false,
      });
    }
    if (/^\/spaces\/[^/]+$/.test(pathname))
      return ok(
        spaces.find(
          (space) =>
            pathname.endsWith(space.slug) || pathname.endsWith(space.id),
        ),
      );
    if (pathname.endsWith("/ai/status"))
      return ok({ enabled: false, configured: false });
    if (pathname.endsWith("/ai/config"))
      return ok({
        spaceId: spaces[0].id,
        enabled: false,
        configured: false,
        agentEnabled: false,
        assistantNameEnabled: false,
        assistantName: "",
        assistantGender: "masculine",
        baseUrl: "",
        chatModel: "",
        systemInstructions: "",
        temperature: 0.3,
        maxOutputTokens: 4096,
        contextWindow: 16000,
        requestTimeoutMs: 120000,
        dailyRequestLimitPerUser: 100,
        dailyTokenLimitPerSpace: 100000,
        retentionDays: 30,
        visionEnabled: false,
        reasoningEnabled: false,
        allowedModels: [],
        quickCommands: [],
        tools: {},
        retrieval: {
          adapter: "none",
          url: "",
          openWebUi: { baseUrl: "", knowledgeId: "", apiKeyConfigured: false },
          timeoutMs: 10000,
          maxResults: 5,
          queryMode: "hybrid",
          followUpRewriteEnabled: false,
        },
        knowledgeAccess: {},
      });
    if (pathname.includes("/templates/policies/spaces/")) {
      if (pathname.endsWith("/groups"))
        return ok({
          items: [{ id: "group1", name: "Editors" }],
          nextCursor: null,
        });
      return ok(pathname.includes("/groups/") ? groupPolicy : policy);
    }
    return ok({ items: [], meta, count: 0 });
  });
  return {
    writes,
    failNext: () => {
      fail = true;
    },
    failReads: (value: boolean) => {
      failReads = value;
    },
    conflict: () => {
      groupPolicy.revision++;
    },
    spaces,
  };
}

test("server search, archive filters, list return, saves, errors, Back, slug replacement, and AI return", async ({
  page,
}) => {
  const data = await fixture(page);
  await page.goto("/settings/spaces");
  await expect(
    page.getByRole("link", { name: "Space 01", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search spaces", { exact: true }).fill("research");
  await expect(
    page.getByRole("link", { name: "Space 43", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Space 43", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "General", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Space name", { exact: true }).fill("Changed research");
  await page
    .locator('nav[aria-label="Space settings"]')
    .getByRole("link", { name: "Documents", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  data.failNext();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("Could not save changes.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("Space name", { exact: true })).toHaveValue(
    "Changed research",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  expect(data.writes.at(-1).body).toEqual({ name: "Changed research" });
  await page.getByLabel("Space address", { exact: true }).fill("researchnew");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/researchnew\/general$/);
  await page.reload();
  await expect(page.getByLabel("Space address", { exact: true })).toHaveValue(
    "researchnew",
  );
  await page.getByLabel("Space name", { exact: true }).fill("Unsaved");
  await page.goBack();
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .locator('nav[aria-label="Space settings"]')
    .getByRole("link", { name: "AI assistant", exact: true })
    .click();
  await page.getByRole("link", { name: /Open.*settings/i }).click();
  await expect(page).toHaveURL(
    /settings\/ai\/spaces\/researchnew\?from=space-settings/,
  );
  await page.getByRole("link", { name: "Space settings", exact: true }).click();
  await expect(page).toHaveURL(/\/researchnew\/ai$/);
  await page
    .locator("#docmost-main-content")
    .getByRole("link", { name: "Spaces", exact: true })
    .click();
  await expect(page.getByLabel("Search spaces", { exact: true })).toHaveValue(
    "research",
  );
  await expect(
    page.getByRole("link", { name: "Changed research", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Changed research", exact: true })
    .click();
  await expect(page.getByLabel("Space name", { exact: true })).toHaveValue(
    "Changed research",
  );
  await page
    .locator("#docmost-primary-sidebar")
    .getByRole("link", { name: "Spaces", exact: true })
    .click();
  await expect(page.getByLabel("Search spaces", { exact: true })).toHaveValue(
    "research",
  );
});

test("pagination, archives, empty results, error recovery, and scroll restoration", async ({
  page,
}, testInfo) => {
  const data = await fixture(page);
  await page.goto("/settings/spaces");
  await expect(page.locator("tbody tr")).toHaveCount(20);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Space 21", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page.getByRole("button", { name: "Prev", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(20);
  await page
    .getByRole("link", { name: "Space 35", exact: true })
    .scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => window.scrollY);
  expect(scroll).toBeGreaterThan(100);
  await page.getByRole("link", { name: "Space 35", exact: true }).click();
  await expect(page.getByLabel("Space name", { exact: true })).toHaveValue(
    "Space 35",
  );
  await page.reload();
  await expect(page.getByLabel("Space name", { exact: true })).toHaveValue(
    "Space 35",
  );
  await page.goBack();
  await expect(page.locator("tbody tr")).toHaveCount(20);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeCloseTo(scroll, 0);
  await page.getByRole("textbox", { name: "Status", exact: true }).click();
  await page.getByRole("option", { name: "Archived", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: "Space 42", exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Status", exact: true }).click();
  await page.getByRole("option", { name: "All", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(20);
  await page.screenshot({
    path: testInfo.outputPath("administration-list.png"),
    fullPage: true,
  });
  await page.getByLabel("Search spaces", { exact: true }).fill("no-such-space");
  await expect(
    page.getByText("No spaces match your search", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(page.locator("tbody tr")).toHaveCount(20);
  data.failReads(true);
  await page.reload();
  await expect(
    page.getByText("Could not load spaces", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  data.failReads(false);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(20);
  data.spaces.splice(0);
  await page.reload();
  await expect(
    page.getByText("No spaces in this view", { exact: true }),
  ).toBeVisible();
});

test("keyboard navigation, focus recovery, and mobile section selection", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/settings/spaces/space1/general");
  const name = page.getByLabel("Space name", { exact: true });
  await name.fill("Keyboard draft");
  const link = page
    .locator('nav[aria-label="Space settings"]')
    .getByRole("link", { name: "Documents", exact: true });
  await link.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog).not.toBeVisible();
  await expect(link).toBeFocused();
  await name.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Space address", { exact: true })).toBeFocused();
  await page.setViewportSize({ width: 360, height: 800 });
  await page
    .getByRole("textbox", { name: "Settings section", exact: true })
    .click();
  await page.getByRole("option", { name: "Documents", exact: true }).click();
  await expect(dialog).toBeVisible();
  await page
    .getByRole("button", { name: "Discard and leave", exact: true })
    .click();
  await expect(page).toHaveURL(/\/documents$/);
});

test("creation opens administration settings or catalog content according to its entry point", async ({
  page,
}) => {
  const data = await fixture(page);
  await page.goto("/settings/spaces");
  await page.getByRole("button", { name: "Create space", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Create space", exact: true });
  await dialog.getByLabel("Space name", { exact: false }).fill("Created admin");
  data.failNext();
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Space name", { exact: false })).toHaveValue(
    "Created admin",
  );
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/spaces\/[^/]+\/general$/);
  await page.goto("/spaces");
  await page.getByRole("button", { name: "Create space", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Create space", exact: true });
  await dialog
    .getByLabel("Space name", { exact: false })
    .fill("Created catalog");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/s\/[^/]+$/);
});

test("document cancellation and access confirmation apply only the saved section", async ({
  page,
}) => {
  const data = await fixture(page);
  await page.goto("/settings/spaces/space1/documents");
  const dictionary = page.getByRole("checkbox", {
    name: "Enable dictionary",
    exact: true,
  });
  await dictionary.check();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dictionary).not.toBeChecked();
  expect(data.writes).toHaveLength(0);
  await dictionary.check();
  await page
    .locator("main")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(
    page.locator("main").getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  expect(data.writes.at(-1).body).toEqual({ dictionaryEnabled: true });
  await page
    .locator('nav[aria-label="Space settings"]')
    .getByRole("link", { name: "Access", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Public sharing", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Public links disabled", exact: true })
    .click();
  expect(data.writes).toHaveLength(1);
  await page
    .locator("main")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  const confirmation = page.getByRole("dialog").filter({
    hasText: "All existing shared links in this space will be deleted.",
  });
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(data.writes).toHaveLength(1);
  await page
    .locator("main")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await confirmation.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.locator("main").getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  expect(data.writes.at(-1).body).toEqual({ disablePublicSharing: true });
  expect(data.spaces[0].settings).toMatchObject({
    dictionary: { enabled: true },
  });
});

test("ordinary members open content from the administrative list", async ({
  page,
}) => {
  await fixture(page, "en-US", "light", "member");
  await page.goto("/settings/spaces");
  await expect(
    page.getByRole("link", { name: "Space 01", exact: true }),
  ).toHaveAttribute("href", "/s/space1");
});

test("template space and group drafts save independently and retain a conflict", async ({
  page,
}) => {
  const data = await fixture(page);
  await page.goto("/settings/spaces/space1/templates");
  await page
    .getByLabel("Enable page templates in this space", { exact: true })
    .check();
  expect(data.writes).toHaveLength(0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("textbox", { name: "Groups", exact: true }).click();
  await page.getByRole("option", { name: "Editors", exact: true }).click();
  await page.getByLabel("Inherit from space policy", { exact: true }).uncheck();
  await page
    .getByRole("form", { name: "Selected group permissions" })
    .getByLabel("Create template", { exact: true })
    .uncheck();
  data.conflict();
  await page
    .getByRole("form", { name: "Selected group permissions" })
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(
    page.getByText("Settings changed elsewhere", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("form", { name: "Selected group permissions" })
      .getByLabel("Create template", { exact: true }),
  ).not.toBeChecked();
});

for (const locale of ["en-US", "ru-RU"])
  for (const theme of ["light", "dark"])
    for (const width of [360, 768, 1440]) {
      test(`layout ${locale} ${theme} ${width}`, async ({ page }, testInfo) => {
        await fixture(page, locale, theme);
        await page.setViewportSize({ width, height: 1000 });
        await page.goto("/settings/spaces");
        await expect(page.locator("tbody tr")).toHaveCount(20);
        for (const url of [
          "/settings/spaces",
          "/settings/spaces/space1/general",
          "/settings/spaces/space1/access",
          "/settings/spaces/space1/documents",
          "/settings/spaces/space1/navigation",
          "/settings/spaces/space1/members",
          "/settings/spaces/space1/templates",
          "/settings/spaces/space1/ai",
          "/settings/spaces/space1/maintenance",
          "/settings/workspace",
        ]) {
          await page.goto(url);
          await expect(page.locator("main")).toBeVisible();
          await expect(
            page.locator("main").getByRole("heading").first(),
          ).toBeVisible();
          await expect(page.getByTestId("route-error")).toHaveCount(0);
          if (
            width === 360 &&
            ((locale === "en-US" && theme === "light") ||
              (locale === "ru-RU" && theme === "dark"))
          ) {
            await expect(
              page.locator("main").locator(".mantine-Loader-root"),
            ).toHaveCount(0);
            const accessibility = await new AxeBuilder({ page })
              .include("main")
              .withTags(["wcag2a", "wcag2aa"])
              .analyze();
            expect(accessibility.violations, url).toEqual([]);
          }
          expect(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth <= window.innerWidth + 1,
            ),
          ).toBe(true);
          await expectContentToFit(page);
        }
        await page.goto("/settings/spaces/space1/general");
        await expect(page.locator("input#name")).toBeVisible();
        const results = await new AxeBuilder({ page })
          .include("main")
          .withTags(["wcag2a", "wcag2aa"])
          .analyze();
        expect(results.violations).toEqual([]);
        await page.screenshot({
          path: testInfo.outputPath(`${locale}-${theme}-${width}.png`),
          fullPage: true,
        });
        if (width === 1440) {
          await page.evaluate(() => {
            document.documentElement.style.fontSize = "200%";
          });
          expect(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth <= window.innerWidth + 1,
            ),
          ).toBe(true);
          await expectContentToFit(page);
        }
      });
    }
