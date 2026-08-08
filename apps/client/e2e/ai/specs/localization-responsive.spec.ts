import { expect, loadState, messageComposer, openAssistant, test } from "../support";

test("localized assistant remains operable at desktop, mobile and narrow widths", async ({ page }, testInfo) => {
  const state = await loadState();
  await openAssistant(page, state);
  await expect(messageComposer(page)).toBeVisible();
  await expect(page.getByRole("button", { name: /New chat|Новый чат/i })).toBeVisible();
  await page.screenshot({
    path: `${testInfo.outputDir}/ai-panel-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
