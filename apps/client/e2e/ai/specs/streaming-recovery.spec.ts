import type { Locator, Page } from "@playwright/test";
import {
  expect,
  loadState,
  messageComposer,
  openAssistant,
  test,
} from "../support";

const composerWidths = [360, 400, 520] as const;

async function setAiPanelWidth(page: Page, targetWidth: number) {
  const resizeHandle = page.locator(
    '[role="separator"][aria-valuemin="360"][aria-valuemax="520"]',
  );
  let currentWidth = Number(await resizeHandle.getAttribute("aria-valuenow"));

  while (currentWidth !== targetWidth) {
    const nextWidth =
      currentWidth < targetWidth
        ? Math.min(targetWidth, currentWidth + 10)
        : Math.max(targetWidth, currentWidth - 10);
    await resizeHandle.press(
      currentWidth < targetWidth ? "ArrowLeft" : "ArrowRight",
    );
    await expect(resizeHandle).toHaveAttribute(
      "aria-valuenow",
      String(nextWidth),
    );
    currentWidth = nextWidth;
  }
}

async function expectFooterToFit(footer: Locator, busy: boolean) {
  const metrics = await footer.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const visibleChildren = Array.from(element.children).filter(
      (child) => getComputedStyle(child).display !== "none",
    );

    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      childrenInside: visibleChildren.every((child) => {
        const rect = child.getBoundingClientRect();
        return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
      }),
      buttonCount: element.querySelectorAll("button").length,
      statusFits: (() => {
        const status = element.querySelector('[role="status"]');
        return !status || status.scrollWidth <= status.clientWidth;
      })(),
    };
  });

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  expect(metrics.childrenInside).toBe(true);
  if (busy) {
    expect(metrics.buttonCount).toBe(1);
    expect(metrics.statusFits).toBe(true);
  } else {
    expect(metrics.buttonCount).toBeGreaterThan(1);
  }
}

test("streaming survives reload and a delayed run can be stopped", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const state = await loadState();
  await openAssistant(page, state);
  const resizeHandle = page.locator(
    '[role="separator"][aria-valuemin="360"][aria-valuemax="520"]',
  );
  await expect(resizeHandle).toBeVisible();
  const originalWidth = Number(
    await resizeHandle.getAttribute("aria-valuenow"),
  );
  const composer = messageComposer(page);
  await composer.fill("AUDIT_DELAY");
  await composer.press("Enter");
  const footer = page.getByTestId("ai-composer-footer");
  const runStatus = page.getByTestId("ai-composer-run-status");
  const stop = page.getByRole("button", { name: /Stop|Остановить/i });
  await expect(runStatus).toBeVisible();
  await expect(runStatus).toHaveAttribute("role", "status");
  await expect(runStatus).toHaveAttribute("aria-live", "polite");
  await expect(stop).toBeVisible();

  for (const width of composerWidths) {
    await setAiPanelWidth(page, width);
    await expectFooterToFit(footer, true);
    await expect(runStatus).toBeVisible();
    await expect(stop).toBeVisible();
  }

  await stop.click();
  await expect(runStatus).toHaveCount(0);

  for (const width of composerWidths) {
    await setAiPanelWidth(page, width);
    await expectFooterToFit(footer, false);
  }

  const templates = footer.locator(
    'button[aria-label="Templates"], button[aria-label="Шаблоны"]',
  );
  await setAiPanelWidth(page, 520);
  await expect(templates).toBeVisible();
  expect((await templates.boundingBox())?.width).toBeLessThanOrEqual(44);
  await templates.focus();
  await expect(templates).toBeFocused();
  await templates.hover();
  await expect(
    page.getByRole("tooltip").filter({ hasText: /Templates|Шаблоны/i }),
  ).toBeVisible();
  await templates.press("Enter");
  await expect(page.locator('[role="menu"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(templates).toBeFocused();

  const search = page.locator("button[aria-pressed][aria-label]");
  if ((await search.count()) > 0) {
    const searchLabel = await search.getAttribute("aria-label");
    if (!searchLabel) throw new Error("Search toggle has no accessible name");
    await expect(search).toBeVisible();
    expect((await search.boundingBox())?.width).toBeLessThanOrEqual(44);
    await search.hover();
    await expect(
      page.getByRole("tooltip").filter({ hasText: searchLabel }),
    ).toBeVisible();
  }

  const profileSelector = footer.locator(
    'button[aria-label="Assistant profile"], button[aria-label="Профиль помощника"]',
  );
  if ((await profileSelector.count()) > 0) {
    await profileSelector.focus();
    await expect(profileSelector).toBeFocused();
    await profileSelector.press("Enter");
    await expect(page.locator('[role="menu"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(profileSelector).toBeFocused();
  }

  await setAiPanelWidth(page, originalWidth);
  await expect(
    page.getByText(/generation stopped|Генерация ответа остановлена/i),
  ).toBeVisible();

  await page
    .getByRole("button", { name: /Retry|Повторить/i })
    .last()
    .click();
  await expect(
    page.getByText("late answer", { exact: true }).last(),
  ).toBeVisible();

  await page.getByRole("button", { name: /New chat|Новый чат/i }).click();
  const nextComposer = messageComposer(page);
  await nextComposer.fill("AUDIT_NORMAL_AFTER_STOP");
  await nextComposer.press("Enter");
  await expect(
    page.getByText("Deterministic mock answer", { exact: false }).last(),
  ).toBeVisible();
  await context.setOffline(true);
  await context.setOffline(false);
  await page.reload();
  await expect(
    page.getByText("Deterministic mock answer", { exact: false }).last(),
  ).toBeVisible();
});
