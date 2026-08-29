import {
  expect,
  loadState,
  messageComposer,
  openAssistant,
  test,
} from "../support";

test("supported image and unsupported file are handled without leaking state", async ({
  page,
}) => {
  const state = await loadState();
  await openAssistant(page, state);
  const add = page.getByRole("button", { name: /^(Add|Добавить)$/i });
  const attachFiles = page.getByRole("menuitem", {
    name: /Attach files|Добавить файлы/i,
  });

  await add.click();
  await expect(attachFiles).toBeVisible();
  const imageChooserPromise = page.waitForEvent("filechooser");
  await attachFiles.click();
  const imageChooser = await imageChooserPromise;
  await imageChooser.setFiles({
    name: "audit-image.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(
    page.getByText("audit-image.png", { exact: false }),
  ).toBeVisible();

  await add.click();
  await expect(attachFiles).toBeVisible();
  const unsupportedChooserPromise = page.waitForEvent("filechooser");
  await attachFiles.click();
  const unsupportedChooser = await unsupportedChooserPromise;
  await unsupportedChooser.setFiles({
    name: "unsupported.exe",
    mimeType: "application/x-msdownload",
    buffer: Buffer.from("not-an-executable"),
  });
  await expect(
    page.getByText(/unsupported|not supported|не поддерж/i),
  ).toBeVisible();
});

for (const scenario of [
  "AUDIT_EMPTY",
  "AUDIT_MALFORMED",
  "AUDIT_DISCONNECT",
] as const) {
  test(`${scenario} becomes a localized recoverable provider error`, async ({
    page,
  }) => {
    const state = await loadState();
    await openAssistant(page, state);
    await page.getByRole("button", { name: /New chat|Новый чат/i }).click();
    const composer = messageComposer(page);
    await composer.fill(scenario);
    await composer.press("Enter");
    await expect(
      page.getByText(
        /AI generation failed|Failed to create a response|Ошибка генерации|Не удалось сгенерировать|Не удалось создать ответ/i,
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Retry|Повторить/i }),
    ).toBeVisible();
  });
}
