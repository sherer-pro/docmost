import {
  apiGet,
  apiPost,
  createAdminApi,
  loadAuditState,
} from "../support/api";
import { pageUrl, seedComplexDocument } from "../support/complex-document";
import {
  captureStep,
  expect,
  mainEditor,
  runAxe,
  test,
} from "../support/audit-test";

test("mobile and touch rendering reflows without document-level horizontal overflow", async ({
  page,
}, testInfo) => {
  const api = await createAdminApi();
  const state = await loadAuditState();
  const current = await apiGet<any>(api, "/api/users/me");
  const original = current.user.settings?.preferences ?? {};
  const seeded = await seedComplexDocument(
    api,
    state,
    `${testInfo.project.name}-mobile`,
  );

  try {
    await apiPost(api, "/api/users/update", {
      aiPanelOpen: false,
      pageEditModeByPageId: {
        ...(original.pageEditModeByPageId ?? {}),
        [seeded.page.id]: "read",
      },
    });
    await page.goto(pageUrl(state, seeded.page));
    await expect(mainEditor(page)).toContainText("Editor regression audit");
    await expect(page.locator(".editor-container")).toBeVisible({
      timeout: 20_000,
    });
    const viewportContent = await page
      .locator('meta[name="viewport"]')
      .getAttribute("content");
    expect(viewportContent).toContain("interactive-widget=resizes-content");
    expect(viewportContent).not.toMatch(/user-scalable\s*=\s*no/i);
    expect(viewportContent).not.toMatch(
      /maximum-scale\s*=\s*1(?:\.0)?(?:\D|$)/i,
    );
    const viewport = page.viewportSize();
    expect(viewport?.width).toBeLessThanOrEqual(500);
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(
      overflow.viewportWidth + 2,
    );

    const readMode = page.getByRole("radio", { name: "Read", exact: true });
    const editMode = page.getByRole("radio", { name: "Edit", exact: true });
    await expect(readMode).toBeAttached();
    await expect(editMode).toBeAttached();
    await expect(readMode).toBeChecked();

    for (const width of [320, 360, 412]) {
      await page.setViewportSize({ width, height: 820 });
      const headerFits = await page
        .getByTestId("page-header-actions")
        .evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return {
            noInternalOverflow: element.scrollWidth <= element.clientWidth + 1,
            insideViewport:
              rect.left >= -1 && rect.right <= window.innerWidth + 1,
          };
        });
      expect(headerFits.noInternalOverflow).toBe(true);
      expect(headerFits.insideViewport).toBe(true);
    }

    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: "Page details" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Comments", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Table of contents" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(page.locator(".tableWrapper")).toBeVisible();
    await page.getByAltText("Editor audit image alt text").tap();
    await expect(
      page.getByRole("dialog").filter({
        has: page.getByAltText("Editor audit image alt text"),
      }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await runAxe(page, testInfo, "body");
    await captureStep(page, testInfo, "05-mobile-touch-reflow", {
      fullPage: true,
    });
  } finally {
    await apiPost(api, "/api/users/update", {
      aiPanelOpen: original.aiPanelOpen ?? false,
      fixedToolbar: original.fixedToolbar ?? false,
      pageEditModeByPageId: original.pageEditModeByPageId ?? {},
    }).catch(() => undefined);
    await api.dispose();
  }
});

test("mobile assistant drawer has an accessible name", async ({
  page,
}, testInfo) => {
  const api = await createAdminApi();
  const state = await loadAuditState();
  const current = await apiGet<any>(api, "/api/users/me");
  const original = current.user.settings?.preferences ?? {};
  const seeded = await seedComplexDocument(
    api,
    state,
    `${testInfo.project.name}-assistant-drawer`,
  );

  try {
    await apiPost(api, "/api/users/update", {
      aiPanelOpen: false,
      pageEditModeByPageId: {
        ...(original.pageEditModeByPageId ?? {}),
        [seeded.page.id]: "edit",
      },
    });
    await page.goto(pageUrl(state, seeded.page));
    await expect(mainEditor(page)).toContainText("Editor regression audit");
    const openAssistant = page
      .getByRole("button", {
        name: /AI|ИИ|assistant|помощник|ассистент/i,
      })
      .first();
    const assistantDialog = page.locator('[role="dialog"]:visible');
    if (!(await assistantDialog.isVisible().catch(() => false))) {
      await openAssistant.tap();
    }
    await expect(assistantDialog).toBeVisible();
    await expect(assistantDialog).toHaveAccessibleName(/.+/);
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(
      overflow.viewportWidth + 2,
    );
    await captureStep(page, testInfo, "06-mobile-assistant-dialog", {
      fullPage: false,
    });
  } finally {
    await apiPost(api, "/api/users/update", {
      aiPanelOpen: original.aiPanelOpen ?? false,
      pageEditModeByPageId: original.pageEditModeByPageId ?? {},
    }).catch(() => undefined);
    await api.dispose();
  }
});
