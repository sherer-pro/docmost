import { expect, loadState, messageComposer, openAssistant, test } from "../support";

test("streaming survives reload and a delayed run can be stopped", async ({ page, context }) => {
  const state = await loadState();
  await openAssistant(page, state);
  const composer = messageComposer(page);
  await composer.fill("AUDIT_DELAY");
  await composer.press("Enter");
  const stop = page.getByRole("button", { name: /Stop|Остановить/i });
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(page.getByText(/generation stopped|Генерация ответа остановлена/i)).toBeVisible();

  await composer.fill("AUDIT_NORMAL_AFTER_STOP");
  await composer.press("Enter");
  await expect(page.getByText("Deterministic mock answer", { exact: false })).toBeVisible();
  await context.setOffline(true);
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByText("Deterministic mock answer", { exact: false })).toBeVisible();
});
