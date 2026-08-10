import type { Route } from "@playwright/test";
import {
  apiGet,
  apiPost,
  createAdminApi,
  createPage,
  deletePage,
  loadAuditState,
} from "../support/api";
import { pageUrl } from "../support/complex-document";
import { captureStep, expect, mainEditor, test } from "../support/audit-test";

test("editor lifecycle recovers from a missing collab token without duplicate providers", async ({
  page,
}, testInfo) => {
  const api = await createAdminApi();
  const state = await loadAuditState();
  const current = await apiGet<any>(api, "/api/users/me");
  const original = current.user.settings?.preferences ?? {};
  const first = await createPage(
    api,
    state.spaceId,
    `${testInfo.project.name} lifecycle first`,
    {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Lifecycle first page content" }],
        },
      ],
    },
  );
  const second = await createPage(
    api,
    state.spaceId,
    `${testInfo.project.name} lifecycle child`,
    {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Lifecycle child page content" }],
        },
      ],
    },
    first.id,
  );
  const third = await createPage(
    api,
    state.spaceId,
    `${testInfo.project.name} auth refresh`,
    {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Authentication refresh content" }],
        },
      ],
    },
  );
  const pageErrors: string[] = [];
  const collabStatsUrl = process.env.DOCMOST_COLLAB_STATS_URL?.trim();
  const serverConnectionCount = async () => {
    if (!collabStatsUrl) return null;
    const response = await page.request.get(collabStatsUrl);
    expect(response.ok()).toBe(true);
    const payload = (await response.json()) as {
      data?: { connections?: number };
      connections?: number;
    };
    return payload.data?.connections ?? payload.connections ?? null;
  };
  page.on("pageerror", (error) => pageErrors.push(error.message));
  if (!collabStatsUrl) {
    testInfo.annotations.push({
      type: "capability",
      description:
        "Server-side duplicate-socket assertion skipped because DOCMOST_COLLAB_STATS_URL is not configured.",
    });
  }

  const collabTokenPattern = "**/api/auth/collab-token**";
  let missingTokenCalls = 0;
  const rejectMissingToken = async (route: Route) => {
    missingTokenCalls += 1;
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        statusCode: 404,
        message: "Synthetic missing token",
      }),
    });
  };
  let networkTokenCalls = 0;
  const failTokenRequestOnce = async (route: Route) => {
    networkTokenCalls += 1;
    if (networkTokenCalls === 1) {
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  };
  let authRefreshCalls = 0;
  const rejectFirstSocketCredential = async (route: Route) => {
    authRefreshCalls += 1;
    if (authRefreshCalls !== 1) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const payload = (await response.json()) as {
      data?: { token?: string };
      token?: string;
    };
    if (payload.data) payload.data.token = "synthetic.invalid.collab.token";
    else payload.token = "synthetic.invalid.collab.token";
    await route.fulfill({ response, json: payload });
  };

  try {
    await apiPost(api, "/api/users/update", {
      pageEditModeByPageId: {
        ...(original.pageEditModeByPageId ?? {}),
        [first.id]: "edit",
        [second.id]: "edit",
        [third.id]: "edit",
      },
    });
    await page.route(collabTokenPattern, rejectMissingToken);
    await page.goto(pageUrl(state, first));
    await expect(mainEditor(page)).toContainText(
      "Lifecycle first page content",
    );
    await expect(mainEditor(page)).toHaveAttribute("contenteditable", "false");
    await page.waitForTimeout(5_500);
    expect(missingTokenCalls).toBe(1);
    if (collabStatsUrl) await expect.poll(serverConnectionCount).toBe(0);

    await page.unroute(collabTokenPattern, rejectMissingToken);
    await page.route(collabTokenPattern, failTokenRequestOnce);
    await page.reload();
    await expect(mainEditor(page)).toHaveAttribute("contenteditable", "true", {
      timeout: 20_000,
    });
    expect(networkTokenCalls).toBe(2);
    await page.unroute(collabTokenPattern, failTokenRequestOnce);
    await expect(mainEditor(page)).toContainText(
      "Lifecycle first page content",
    );
    if (collabStatsUrl) await expect.poll(serverConnectionCount).toBe(1);

    await mainEditor(page).getByText("Lifecycle first page content").dblclick();
    await page.goto(pageUrl(state, second));
    await expect(mainEditor(page)).toContainText(
      "Lifecycle child page content",
    );
    if (collabStatsUrl) await expect.poll(serverConnectionCount).toBe(1);
    await deletePage(api, second.id);
    await page.goBack();
    await expect(mainEditor(page)).toContainText(
      "Lifecycle first page content",
    );
    await expect(mainEditor(page)).toHaveAttribute("contenteditable", "true", {
      timeout: 20_000,
    });
    if (collabStatsUrl) await expect.poll(serverConnectionCount).toBe(1);
    expect(pageErrors).toEqual([]);
    await captureStep(page, testInfo, "06-lifecycle-collab-recovery");

    await page.route(collabTokenPattern, rejectFirstSocketCredential);
    await page.goto(pageUrl(state, third));
    await expect(mainEditor(page)).toContainText(
      "Authentication refresh content",
    );
    await expect(mainEditor(page)).toHaveAttribute("contenteditable", "true", {
      timeout: 20_000,
    });
    await expect.poll(() => authRefreshCalls).toBeGreaterThanOrEqual(2);
    if (collabStatsUrl) await expect.poll(serverConnectionCount).toBe(1);
    expect(pageErrors).toEqual([]);
    await page.unroute(collabTokenPattern, rejectFirstSocketCredential);
  } finally {
    await page
      .unroute(collabTokenPattern, rejectMissingToken)
      .catch(() => undefined);
    await page
      .unroute(collabTokenPattern, failTokenRequestOnce)
      .catch(() => undefined);
    await page
      .unroute(collabTokenPattern, rejectFirstSocketCredential)
      .catch(() => undefined);
    await apiPost(api, "/api/users/update", {
      fixedToolbar: original.fixedToolbar ?? false,
      pageEditModeByPageId: original.pageEditModeByPageId ?? {},
    }).catch(() => undefined);
    await deletePage(api, second.id).catch(() => undefined);
    await deletePage(api, third.id).catch(() => undefined);
    await deletePage(api, first.id).catch(() => undefined);
    await api.dispose();
  }
});
