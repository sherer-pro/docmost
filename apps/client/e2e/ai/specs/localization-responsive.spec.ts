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

  const search = page.getByRole("switch", {
    name: english
      ? "Include space search"
      : "Использовать поиск по пространству",
    exact: true,
  });
  await expect(search).toBeVisible();
  const searchWasChecked = await search.isChecked();
  await search.click();
  await expect(search).toBeEnabled();
  await expect(search).toBeChecked({ checked: !searchWasChecked });
  await search.click();
  await expect(search).toBeEnabled();
  await expect(search).toBeChecked({ checked: searchWasChecked });

  const mode = page.getByTestId("ai-composer-mode");
  await expect(
    mode.getByText(english ? "Chat" : "Чат", { exact: true }),
  ).toBeVisible();
  await expect(
    mode.getByText(english ? "Agent" : "Агент", { exact: true }),
  ).toBeVisible();

  if (["pixel-7", "mobile-webkit"].includes(testInfo.project.name)) {
    const toolbar = page.getByTestId("ai-composer-toolbar");
    const modeBox = await mode.boundingBox();
    const toolbarBox = await toolbar.boundingBox();
    expect(modeBox?.width).toBeGreaterThanOrEqual(
      (toolbarBox?.width ?? 0) - 16,
    );

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
