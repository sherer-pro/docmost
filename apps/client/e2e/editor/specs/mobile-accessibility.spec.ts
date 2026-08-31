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
import type { Locator, Page as PlaywrightPage } from "@playwright/test";

async function settleTableLayout(page: PlaywrightPage) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function getTableOverflowGeometry(wrapper: Locator, marker: string) {
  return wrapper.evaluate((element, markerText) => {
    const table = element.querySelector("table")!;
    const textWalker = document.createTreeWalker(table, NodeFilter.SHOW_TEXT);
    let markerLineCount: number | null = null;
    let textNode = textWalker.nextNode();

    while (textNode) {
      const start = textNode.textContent?.indexOf(markerText) ?? -1;
      if (start >= 0) {
        const range = document.createRange();
        range.setStart(textNode, start);
        range.setEnd(textNode, start + markerText.length);
        markerLineCount = range.getClientRects().length;
        break;
      }
      textNode = textWalker.nextNode();
    }

    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      scrollLeft: element.scrollLeft,
      tableWidth: table.getBoundingClientRect().width,
      columnWidths: Array.from(
        table.querySelectorAll(":scope > colgroup > col"),
        (column) => column.getBoundingClientRect().width,
      ),
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      markerLineCount,
    };
  }, marker);
}

async function getVisibleHeaderActionOrder(page: PlaywrightPage) {
  return page
    .getByTestId("page-header-actions")
    .locator("[data-page-header-action]")
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== "none";
        })
        .map((element) => element.getAttribute("data-page-header-action")),
    );
}

async function expectMobileHeaderActions(page: PlaywrightPage) {
  const order = await getVisibleHeaderActionOrder(page);
  const expected = ["ai", "toc", "comments"];
  if (order.includes("share")) {
    expected.push("share");
  }
  expected.push("menu");

  expect(order).toEqual(expected);
  expect(order).not.toContain("favorite");
  expect(order).not.toContain("details");
}

async function expectHeaderFitsMobileWidths(page: PlaywrightPage) {
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
}

async function expectMobileOverflowActions(page: PlaywrightPage) {
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  const order = await page
    .locator("[data-page-header-menu-action]:visible")
    .evaluateAll((elements) =>
      elements.map((element) =>
        element.getAttribute("data-page-header-menu-action"),
      ),
    );

  expect(order).toEqual(["favorite", "details"]);
  await expect(
    page.getByRole("menuitem", { name: "Comments", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Table of contents", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
}

async function expectMobileHeaderActionsOpen(page: PlaywrightPage) {
  await page.locator('[data-page-header-action="toc"]').click();
  const tocDialog = page.getByRole("dialog", {
    name: "Table of contents",
    exact: true,
  });
  await expect(tocDialog).toBeVisible();
  await tocDialog
    .getByRole("button", { name: "Close panel", exact: true })
    .click();
  await expect(tocDialog).toBeHidden();

  await page.locator('[data-page-header-action="comments"]').click();
  const commentsDialog = page.getByRole("dialog", {
    name: "Comments",
    exact: true,
  });
  await expect(commentsDialog).toBeVisible();
  await commentsDialog
    .getByRole("button", { name: "Close panel", exact: true })
    .click();
  await expect(commentsDialog).toBeHidden();

  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page.locator('[data-page-header-menu-action="details"]').click();
  const detailsDialog = page.getByRole("dialog", { name: "Page details" });
  await expect(detailsDialog).toBeVisible();
  await detailsDialog.getByRole("button", { name: "Close" }).click();
  await expect(detailsDialog).toBeHidden();
}

async function expectMobileFavoriteToggle(page: PlaywrightPage) {
  const openMenu = page.getByRole("button", {
    name: "Open menu",
    exact: true,
  });
  const favoriteItem = page.locator(
    '[data-page-header-menu-action="favorite"]',
  );

  await openMenu.click();
  const initialLabel = (await favoriteItem.textContent())?.trim();
  expect(["Add to favorites", "Remove from favorites"]).toContain(initialLabel);
  const toggledLabel =
    initialLabel === "Add to favorites"
      ? "Remove from favorites"
      : "Add to favorites";

  await favoriteItem.click();
  await openMenu.click();
  await expect(favoriteItem).toHaveText(toggledLabel);

  await favoriteItem.click();
  await openMenu.click();
  await expect(favoriteItem).toHaveText(initialLabel ?? "");
  await page.keyboard.press("Escape");
}

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

    const compactControlMetrics = await page
      .getByTestId("page-state-segmented-control")
      .evaluate((control) => {
        const labels = Array.from(
          control.querySelectorAll<HTMLElement>(
            ".mantine-SegmentedControl-label",
          ),
        );
        return labels.map((label) => {
          const labelRect = label.getBoundingClientRect();
          const iconRect = label.querySelector("svg")?.getBoundingClientRect();
          const style = window.getComputedStyle(label);
          return {
            width: labelRect.width,
            height: labelRect.height,
            paddingLeft: style.paddingLeft,
            paddingRight: style.paddingRight,
            iconOffsetX: iconRect
              ? iconRect.left +
                iconRect.width / 2 -
                (labelRect.left + labelRect.width / 2)
              : null,
            iconOffsetY: iconRect
              ? iconRect.top +
                iconRect.height / 2 -
                (labelRect.top + labelRect.height / 2)
              : null,
          };
        });
      });
    expect(compactControlMetrics).toHaveLength(2);
    expect(compactControlMetrics[0].width).toBeCloseTo(
      compactControlMetrics[1].width,
      1,
    );
    expect(compactControlMetrics[0].height).toBeCloseTo(
      compactControlMetrics[1].height,
      1,
    );
    for (const metric of compactControlMetrics) {
      expect(metric.paddingLeft).toBe("0px");
      expect(metric.paddingRight).toBe("0px");
      expect(
        Math.abs(metric.iconOffsetX ?? Number.POSITIVE_INFINITY),
      ).toBeLessThan(0.6);
      expect(
        Math.abs(metric.iconOffsetY ?? Number.POSITIVE_INFINITY),
      ).toBeLessThan(0.6);
    }

    await expectHeaderFitsMobileWidths(page);
    await expectMobileHeaderActions(page);
    await expectMobileOverflowActions(page);
    await expectMobileHeaderActionsOpen(page);
    await expectMobileFavoriteToggle(page);

    const tableWrapper = page.locator(".tableWrapper").first();
    await expect(tableWrapper).toBeVisible();

    await editMode.click();
    await expect(editMode).toBeChecked();
    await expect(mainEditor(page)).toHaveAttribute("contenteditable", "true");
    const longWord = "W".repeat(100);
    const tableCell = mainEditor(page)
      .locator("table")
      .first()
      .locator("tr")
      .nth(1)
      .locator("td, th")
      .nth(1)
      .locator("p");
    await tableCell.click();
    await page.keyboard.press("End");
    await page.keyboard.type(` ${longWord}`);
    await expect(mainEditor(page)).toContainText(longWord);

    for (const width of [320, 360, 412]) {
      await page.setViewportSize({ width, height: 820 });
      await settleTableLayout(page);
      const geometry = await getTableOverflowGeometry(tableWrapper, longWord);

      expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth + 100);
      expect(geometry.tableWidth).toBeGreaterThan(geometry.clientWidth + 100);
      expect(
        Math.max(...geometry.columnWidths) - Math.min(...geometry.columnWidths),
      ).toBeGreaterThan(100);
      expect(geometry.markerLineCount).toBe(1);
      expect(geometry.documentWidth).toBeLessThanOrEqual(
        geometry.viewportWidth + 2,
      );

      const scrollLeft = await tableWrapper.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
        return element.scrollLeft;
      });
      expect(scrollLeft).toBeGreaterThan(0);
    }

    await readMode.click();
    await expect(readMode).toBeChecked();
    await expect(mainEditor(page)).toHaveAttribute("contenteditable", "false");
    await expect(mainEditor(page)).toContainText(longWord);
    await settleTableLayout(page);
    const readGeometry = await getTableOverflowGeometry(tableWrapper, longWord);
    expect(readGeometry.scrollWidth).toBeGreaterThan(
      readGeometry.clientWidth + 100,
    );
    expect(readGeometry.documentWidth).toBeLessThanOrEqual(
      readGeometry.viewportWidth + 2,
    );

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

test("mobile database and row headers use the same action order", async ({
  page,
}, testInfo) => {
  const api = await createAdminApi();
  const state = await loadAuditState();
  const current = await apiGet<any>(api, "/api/users/me");
  const original = current.user.settings?.preferences ?? {};
  const suffix = `${testInfo.project.name}-${Date.now()}`;

  try {
    const database = await apiPost<any>(api, "/api/databases", {
      spaceId: state.spaceId,
      name: `Header order database ${suffix}`,
    });
    const databasePage = await apiGet<any>(
      api,
      `/api/pages/info?pageId=${database.pageId}`,
    );
    const row = await apiPost<any>(api, `/api/databases/${database.id}/rows`, {
      title: `Header order row ${suffix}`,
      parentPageId: database.pageId,
    });
    const rowPage = await apiGet<any>(
      api,
      `/api/pages/info?pageId=${row.pageId}`,
    );

    await apiPost(api, "/api/users/update", {
      pageEditModeByPageId: {
        ...(original.pageEditModeByPageId ?? {}),
        [databasePage.id]: "read",
        [rowPage.id]: "read",
      },
    });

    await page.goto(`/s/${state.spaceSlug}/db/${databasePage.slugId}`);
    await expect(page.getByTestId("page-header-actions")).toBeVisible();
    await expectHeaderFitsMobileWidths(page);
    await expectMobileHeaderActions(page);
    await expectMobileOverflowActions(page);

    await page.goto(pageUrl(state, rowPage));
    await expect(page.getByTestId("page-header-actions")).toBeVisible();
    await expectHeaderFitsMobileWidths(page);
    await expectMobileHeaderActions(page);
    await expectMobileOverflowActions(page);
  } finally {
    await apiPost(api, "/api/users/update", {
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
