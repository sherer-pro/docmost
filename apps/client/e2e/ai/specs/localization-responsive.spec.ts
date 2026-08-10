import path from "node:path";
import { auditRoot, expect, loadState, messageComposer, openAssistant, test } from "../support";

test("localized assistant remains operable at desktop, mobile and narrow widths", async ({ page }, testInfo) => {
  const state = await loadState();
  await openAssistant(page, state);
  await expect(messageComposer(page)).toBeVisible();
  const expectedNewChat = testInfo.project.name.includes("en-")
    ? "New chat"
    : "Новый чат";
  await expect(
    page.getByRole("button", { name: expectedNewChat, exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `${testInfo.outputDir}/ai-panel-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.screenshot({
    path: path.join(auditRoot, "screenshots", `ai-panel-${testInfo.project.name}.png`),
    fullPage: true,
  });
});
