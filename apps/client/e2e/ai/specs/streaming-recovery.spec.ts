import type { Locator, Page } from "@playwright/test";
import {
  expect,
  loadState,
  messageComposer,
  openAssistant,
  test,
} from "../support";

const composerWidths = [360, 400, 520, 600] as const;

async function setAiPanelWidth(page: Page, targetWidth: number) {
  const resizeHandle = page.locator(
    '[role="separator"][aria-valuemin="360"][aria-valuemax="600"]',
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
      enabledButtonCount: Array.from(
        element.querySelectorAll<HTMLButtonElement>("button"),
      ).filter((button) => !button.disabled).length,
    };
  });

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  expect(metrics.childrenInside).toBe(true);
  if (busy) {
    expect(metrics.enabledButtonCount).toBe(1);
  } else {
    expect(metrics.enabledButtonCount).toBeGreaterThan(1);
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
    '[role="separator"][aria-valuemin="360"][aria-valuemax="600"]',
  );
  await expect(resizeHandle).toBeVisible();
  const originalWidth = Number(
    await resizeHandle.getAttribute("aria-valuenow"),
  );
  const composer = messageComposer(page);
  await setAiPanelWidth(page, 400);
  await composer.fill("RESIZE_DRAFT");
  const handleBounds = await resizeHandle.boundingBox();
  if (!handleBounds) throw new Error("AI panel resize handle is not visible");
  await page.mouse.move(
    handleBounds.x + handleBounds.width / 2,
    handleBounds.y + 80,
  );
  await page.mouse.down();
  await page.mouse.move(1000, handleBounds.y + 80, { steps: 8 });
  await page.mouse.up();
  await expect(resizeHandle).toHaveAttribute("aria-valuenow", "600");
  await expect(page.locator("#docmost-context-aside")).toHaveAttribute(
    "data-presentation-mode",
    "overlay",
  );
  await expect(composer).toContainText("RESIZE_DRAFT");
  await resizeHandle.press("Home");
  await expect(resizeHandle).toHaveAttribute("aria-valuenow", "360");
  await resizeHandle.press("End");
  await expect(resizeHandle).toHaveAttribute("aria-valuenow", "600");
  await page.waitForTimeout(650);
  await page.reload();
  await openAssistant(page, state);
  await expect(resizeHandle).toHaveAttribute("aria-valuenow", "600");
  await setAiPanelWidth(page, originalWidth);
  await page.waitForTimeout(650);

  await composer.fill("AUDIT_DELAY");
  await composer.press("Enter");
  const footer = page.getByTestId("ai-composer-footer");
  const runStatus = page.getByTestId("ai-composer-run-status");
  const stop = page.getByRole("button", { name: /Stop|Остановить/i });
  await expect(runStatus).toBeAttached();
  await expect(runStatus).toHaveAttribute("role", "status");
  await expect(runStatus).toHaveAttribute("aria-live", "polite");
  await expect(stop).toBeVisible();

  for (const width of composerWidths) {
    await setAiPanelWidth(page, width);
    await expectFooterToFit(footer, true);
    await expect(runStatus).toBeAttached();
    await expect(stop).toBeVisible();
  }

  await stop.click();
  await expect(runStatus).toHaveCount(0);

  for (const width of composerWidths) {
    await setAiPanelWidth(page, width);
    await expectFooterToFit(footer, false);
  }

  const add = footer.getByRole("button", { name: /^(Add|Добавить)$/i });
  await setAiPanelWidth(page, 520);
  await expect(add).toBeVisible();
  expect((await add.boundingBox())?.width).toBeLessThanOrEqual(44);
  await add.focus();
  await expect(add).toBeFocused();
  await add.press("Enter");
  await expect(page.locator('[role="menu"]')).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: /Templates|Шаблоны/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", {
      name: /Markdown formatting|Форматирование Markdown/i,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", {
      name: /Search this space|Искать по пространству/i,
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(add).toBeFocused();

  const profileSelector = footer.locator(
    'button[aria-label="Assistant profile"], button[aria-label="Профиль помощника"]',
  );
  if ((await profileSelector.count()) > 0) {
    await profileSelector.focus();
    await expect(profileSelector).toBeFocused();
    await profileSelector.press("Enter");
    const menu = page.locator('[role="menu"]');
    await expect(menu).toBeVisible();
    expect(
      await menu.getByTestId("ai-profile-option-description").count(),
    ).toBeGreaterThan(1);
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
