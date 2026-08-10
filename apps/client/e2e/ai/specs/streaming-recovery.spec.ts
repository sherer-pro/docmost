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

  await page
    .getByRole("button", { name: /Retry|Повторить/i })
    .last()
    .click();
  await expect(page.getByText("late answer", { exact: true }).last()).toBeVisible();

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
