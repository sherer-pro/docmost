import { expect, loadState, openAssistant, test } from "../support";

test("chat lifecycle, Markdown composer, shortcuts, draft and quick commands", async ({ page }) => {
  const state = await loadState();
  await openAssistant(page, state);

  await page.getByRole("button", { name: /New chat|Новый чат/i }).click();
  const composer = page.getByRole("textbox", { name: /Ask about this document|Спросите об этом документе/i });
  await composer.fill("**bold**\n\n- item");
  await page.reload();
  await openAssistant(page, state);
  await expect(composer).toContainText("bold");
  await composer.press("Shift+Enter");
  await expect(composer).toContainText("bold");
  await composer.press("Enter");
  await expect(page.getByText("Deterministic mock answer", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: /Chat actions|Действия с чатом/i }).click();
  await page.getByText(/Rename chat|Переименовать чат/i, { exact: true }).click();
  const rename = page.getByRole("dialog").getByRole("textbox");
  await rename.fill(`Audit chat ${state.runId}`);
  await page.getByRole("dialog").getByRole("button", { name: /Save|Сохранить/i }).click();
  await expect(page.getByRole("combobox", { name: /Chat history|История чатов/i })).toHaveValue(/.+/);

  await page.getByRole("button", { name: /Templates|Шаблоны/i }).click();
  await expect(page.getByPlaceholder(/Search commands|Поиск команд/i)).toBeVisible();
});

test("reasoning disclosure and regeneration keep the conversation usable", async ({ page }) => {
  const state = await loadState();
  await openAssistant(page, state);
  const composer = page.getByRole("textbox", { name: /Ask about this document|Спросите об этом документе/i });
  await composer.fill("AUDIT_REASONING");
  await composer.press("Enter");
  const disclosure = page.getByRole("button", { name: /Reasoning|Рассуждения/i }).last();
  await expect(disclosure).toBeVisible();
  await disclosure.click();
  await expect(page.getByText("deterministic reasoning", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: /Regenerate|Повторить/i }).last().click();
  await expect(page.getByText("Deterministic mock answer", { exact: false }).last()).toBeVisible();
});

test("chat can be searched and deleted without corrupting the remaining list", async ({ page }) => {
  const state = await loadState();
  await openAssistant(page, state);
  await page.getByRole("button", { name: /New chat|Новый чат/i }).click();
  const composer = page.getByRole("textbox", { name: /Ask about this document|Спросите об этом документе/i });
  await composer.fill(`Searchable audit chat ${state.runId}`);
  await composer.press("Enter");
  await expect(page.getByText("Deterministic mock answer", { exact: false }).last()).toBeVisible();
  await page.getByRole("button", { name: /Chat actions|Действия с чатом/i }).click();
  await page.getByText(/Rename chat|Переименовать чат/i, { exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill(`Audit chat ${state.runId}`);
  await page.getByRole("dialog").getByRole("button", { name: /Save|Сохранить/i }).click();
  const history = page.getByRole("combobox", { name: /Chat history|История чатов/i });
  await history.click();
  await page.keyboard.type("Audit chat");
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Chat actions|Действия с чатом/i }).click();
  await page.getByText(/Delete chat|Удалить чат/i, { exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Delete|Удалить/i }).click();
  await expect(page.getByRole("button", { name: /New chat|Новый чат/i })).toBeEnabled();
});
