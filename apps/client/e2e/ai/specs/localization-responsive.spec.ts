import path from "node:path";
import {
  auditRoot,
  expect,
  loadState,
  messageComposer,
  openAssistant,
  test,
} from "../support";

test("localized assistant remains operable at desktop, mobile and narrow widths", async ({
  page,
}, testInfo) => {
  const state = await loadState();
  await openAssistant(page, state);
  await expect(messageComposer(page)).toBeVisible();
  const english = testInfo.project.name.includes("en-");
  const expectedNewChat = english ? "New chat" : "Новый чат";
  await expect(
    page.getByRole("button", { name: expectedNewChat, exact: true }),
  ).toBeVisible();

  const compactMobile = ["pixel-7", "mobile-webkit"].includes(
    testInfo.project.name,
  );
  const addLabel = english ? "Add" : "Добавить";
  const addToMessageLabel = english ? "Add to message" : "Добавить к сообщению";
  const closeLabel = english ? "Close" : "Закрыть";
  const searchLabel = english ? "Search this space" : "Искать по пространству";
  const add = page.getByRole("button", { name: addLabel, exact: true });
  const searchChip = page
    .getByRole("button", { name: searchLabel, exact: true })
    .and(page.locator('[aria-pressed="true"]'));
  const searchWasEnabled = await searchChip.isVisible().catch(() => false);

  const toggleSpaceSearch = async () => {
    await add.click();
    if (compactMobile) {
      const drawer = page.getByRole("dialog", {
        name: addToMessageLabel,
        exact: true,
      });
      await drawer
        .getByRole("button", { name: searchLabel, exact: true })
        .click();
      await drawer
        .getByRole("button", { name: closeLabel, exact: true })
        .click();
      return;
    }

    await page
      .getByRole("menuitem", { name: searchLabel, exact: true })
      .click();
  };

  await toggleSpaceSearch();
  if (searchWasEnabled) {
    await expect(searchChip).toHaveCount(0);
  } else {
    await expect(searchChip).toBeVisible();
  }
  await toggleSpaceSearch();
  if (searchWasEnabled) {
    await expect(searchChip).toBeVisible();
  } else {
    await expect(searchChip).toHaveCount(0);
  }

  const mode = page.getByRole("button", {
    name: english ? "Mode" : "Режим",
    exact: true,
  });
  await expect(mode).toBeVisible();
  await mode.click();
  await expect(
    page.getByRole("menuitem", {
      name: english ? "Chat" : "Чат",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", {
      name: english ? "Agent" : "Агент",
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  if (compactMobile) {
    const send = page.getByRole("button", {
      name: english ? "Send" : "Отправить",
      exact: true,
    });
    for (const control of [add, mode, send]) {
      const box = await control.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }

    const footerFits = await page
      .getByTestId("ai-composer-footer")
      .evaluate((element) => {
        const footer = element.getBoundingClientRect();
        return Array.from(element.children)
          .filter((child) => {
            const style = window.getComputedStyle(child);
            return style.display !== "none" && style.visibility !== "hidden";
          })
          .every((child) => {
            const rect = child.getBoundingClientRect();
            return (
              rect.left >= footer.left - 1 && rect.right <= footer.right + 1
            );
          });
      });
    expect(footerFits).toBe(true);

    const originalViewport = page.viewportSize();
    expect(originalViewport).not.toBeNull();
    await page.setViewportSize({
      width: originalViewport?.width ?? 412,
      height: 339,
    });
    const shortViewportFits = await page
      .getByTestId("ai-composer-footer")
      .evaluate((element) => {
        const footer = element.getBoundingClientRect();
        const panel = element.closest<HTMLElement>("[data-testid='ai-panel']");
        if (!panel) return false;
        const panelRect = panel.getBoundingClientRect();
        return footer.top >= panelRect.top && footer.bottom <= panelRect.bottom;
      });
    expect(shortViewportFits).toBe(true);
    await page.setViewportSize(originalViewport ?? { width: 412, height: 915 });
  }

  await page.screenshot({
    path: `${testInfo.outputDir}/ai-panel-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.screenshot({
    path: path.join(
      auditRoot,
      "screenshots",
      `ai-panel-${testInfo.project.name}.png`,
    ),
    fullPage: true,
  });
});
