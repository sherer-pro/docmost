import {
  expect,
  loadState,
  messageComposer,
  openAssistant,
  test,
} from "../support";
import type { Page } from "@playwright/test";

async function openComposerSubmenu(page: Page, name: RegExp) {
  await page.getByRole("button", { name: /^(Add|Добавить)$/i }).click();
  const submenu = page.getByRole("menuitem", { name });
  await expect(submenu).toBeVisible();
  await submenu.hover();
}

test("chat lifecycle, Markdown composer, shortcuts, draft and quick commands", async ({
  page,
}) => {
  const state = await loadState();
  await openAssistant(page, state);

  await page.getByRole("button", { name: /New chat|Новый чат/i }).click();
  const composer = messageComposer(page);
  await composer.fill("**bold**\n\n- item");
  await page.reload();
  await openAssistant(page, state);
  await expect(composer).toContainText("bold");
  await composer.press("Shift+Enter");
  await expect(composer).toContainText("bold");
  await composer.press("Enter");
  await expect(
    page.getByText("Deterministic mock answer", { exact: false }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: /Chat actions|Действия с чатом/i })
    .click();
  await page
    .getByText(/Rename chat|Переименовать чат/i, { exact: true })
    .click();
  const rename = page.getByRole("dialog").getByRole("textbox");
  await rename.fill(`Audit chat ${state.runId}`);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Save|Сохранить/i })
    .click();
  await expect(
    page.getByRole("button", { name: /Chat history|История чатов/i }),
  ).toContainText(`Audit chat ${state.runId}`);

  let sentTemplateRequests = 0;
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    if (
      request.method() === "POST" &&
      /\/api\/ai\/conversations\/[^/]+\/messages$/.test(requestUrl.pathname)
    ) {
      sentTemplateRequests += 1;
    }
  });

  await page.keyboard.press("Escape");
  await composer.fill("beforeafter");
  await composer.press("End");
  for (let index = 0; index < "after".length; index += 1) {
    await composer.press("ArrowLeft");
  }
  await openComposerSubmenu(page, /Templates|Шаблоны/i);
  await page.getByRole("menuitem", { name: /Summarize|Резюмировать/i }).click();

  const draftWithTemplate = await composer.innerText();
  const insertedPrompt = draftWithTemplate.match(
    /Identify the main message|Определи основную мысль/i,
  )?.[0];
  expect(insertedPrompt).toBeTruthy();
  expect(draftWithTemplate.indexOf("before")).toBeLessThan(
    draftWithTemplate.indexOf(insertedPrompt!),
  );
  expect(draftWithTemplate.indexOf(insertedPrompt!)).toBeLessThan(
    draftWithTemplate.indexOf("after"),
  );
  await page.waitForTimeout(300);
  expect(sentTemplateRequests).toBe(0);

  const formattingCases: Array<[RegExp, string]> = [
    [/Bold|Жирный/i, "strong"],
    [/Italic|Курсив/i, "em"],
    [/Strikethrough|Зачёркнутый/i, "s"],
    [/Inline code|Встроенный код/i, "code"],
    [/Heading|Заголовок/i, "h1"],
    [/Bullet list|Маркированный список/i, "ul:not([data-type])"],
    [/Numbered list|Нумерованный список/i, "ol"],
    [/Task list|Список задач/i, '[data-type="taskList"]'],
    [/Quote|Цитата/i, "blockquote"],
    [/Code block|Блок кода/i, "pre"],
  ];

  for (const [label, selector] of formattingCases) {
    await composer.fill("format");
    await composer.press("ControlOrMeta+a");
    await openComposerSubmenu(
      page,
      /Markdown formatting|Форматирование Markdown/i,
    );
    await page.getByRole("menuitem", { name: label }).click();
    await expect(composer.locator(selector)).toContainText("format");
  }

  // The previous case intentionally leaves the editor in a code block, where
  // inline marks are not allowed. Restore a paragraph before testing links.
  await composer.press("ControlOrMeta+a");
  await openComposerSubmenu(
    page,
    /Markdown formatting|Форматирование Markdown/i,
  );
  await page.getByRole("menuitem", { name: /Code block|Блок кода/i }).click();
  await expect(composer.locator("p")).toContainText("format");

  await composer.fill("format");
  await composer.press("ControlOrMeta+a");
  await openComposerSubmenu(
    page,
    /Markdown formatting|Форматирование Markdown/i,
  );
  await page
    .getByRole("menuitem", { name: /Add link|Добавить ссылку/i })
    .click();
  await page.getByRole("textbox", { name: "URL" }).fill("https://example.com");
  await page.getByRole("button", { name: /Save|Сохранить/i }).click();
  await expect(composer.locator("a")).toHaveAttribute(
    "href",
    "https://example.com/",
  );
});

test("reasoning disclosure and regeneration keep the conversation usable", async ({
  page,
}) => {
  const state = await loadState();
  await openAssistant(page, state);
  const composer = messageComposer(page);
  await composer.fill("AUDIT_REASONING");
  await composer.press("Enter");
  const disclosure = page
    .getByRole("button", { name: /Reasoning|Рассуждения/i })
    .last();
  await expect(disclosure).toBeVisible();
  await disclosure.click();
  await expect(
    page.getByText("deterministic reasoning", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Regenerate|Создать заново/i })
    .last()
    .click();
  await expect(
    page.getByText("Deterministic mock answer", { exact: false }).last(),
  ).toBeVisible();
});

test("chat can be searched and deleted without corrupting the remaining list", async ({
  page,
}) => {
  const state = await loadState();
  await openAssistant(page, state);
  await page.getByRole("button", { name: /New chat|Новый чат/i }).click();
  const composer = messageComposer(page);
  await composer.fill(`Searchable audit chat ${state.runId}`);
  await composer.press("Enter");
  await expect(
    page.getByText("Deterministic mock answer", { exact: false }).last(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Chat actions|Действия с чатом/i })
    .click();
  await page
    .getByText(/Rename chat|Переименовать чат/i, { exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("textbox")
    .fill(`Audit chat ${state.runId}`);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Save|Сохранить/i })
    .click();
  await page
    .getByRole("button", { name: /Chat history|История чатов/i })
    .click();
  const historySearch = page.getByPlaceholder(/Chat history|История чатов/i);
  await historySearch.fill("Audit chat");
  await expect(
    page
      .getByRole("menuitem")
      .filter({ hasText: `Audit chat ${state.runId}` })
      .first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: /Chat actions|Действия с чатом/i })
    .click();
  await page.getByText(/Delete chat|Удалить чат/i, { exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Delete|Удалить/i })
    .click();
  await expect(
    page.getByRole("button", { name: /New chat|Новый чат/i }),
  ).toBeEnabled();
});
