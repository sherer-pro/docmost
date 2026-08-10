import { csrfHeaders, expect, loadState, test } from "../support";
import type { Page } from "@playwright/test";

async function saveSettings(page: Page, spaceId: string) {
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname ===
          `/api/spaces/${spaceId}/ai/config` &&
        response.ok(),
    ),
    page.getByRole("button", { name: "Сохранить", exact: true }).click(),
  ]);
}

test("owner configures, tests, disables and restores the provider through the UI", async ({
  page,
}) => {
  const state = await loadState();
  await page.goto(`/settings/ai/spaces/${state.spaceSlug}`);

  await page.getByRole("button", { name: "Модель", exact: true }).click();
  const baseUrl = page.getByLabel("Базовый URL провайдера");
  const model = page.getByLabel("Модель чата");
  const temperature = page.getByLabel("Температура");
  await expect(baseUrl).toHaveValue(/host\.docker\.internal:1080/);
  await expect(model).toHaveValue("docmost-audit-model");

  await page
    .getByRole("button", { name: "Проверить модель", exact: true })
    .click();
  await expect(
    page.getByText("Подключение к модели успешно.", { exact: true }).first(),
  ).toBeVisible();

  await page
    .getByRole("button", {
      name: /Расширенные параметры модели/,
    })
    .click();
  await temperature.fill("0.25");
  await saveSettings(page, state.spaceId);
  await page.reload();
  await page.getByRole("button", { name: "Модель", exact: true }).click();
  await page
    .getByRole("button", {
      name: /Расширенные параметры модели/,
    })
    .click();
  await expect(page.getByLabel("Температура")).toHaveValue("0.25");

  await page.getByRole("button", { name: "Обзор", exact: true }).click();
  const enabled = page.getByRole("switch", {
    name: /Включить ИИ-помощника/i,
  });
  await enabled.uncheck();
  await saveSettings(page, state.spaceId);
  await page.reload();
  await expect(
    page.getByRole("switch", { name: /Включить ИИ-помощника/i }),
  ).not.toBeChecked();
  await page.getByRole("switch", { name: /Включить ИИ-помощника/i }).check();
  await saveSettings(page, state.spaceId);
  await page.reload();
  await expect(
    page.getByRole("switch", { name: /Включить ИИ-помощника/i }),
  ).toBeChecked();
});

test("provider test rejects unsafe URL, bad key and timeout and reports a missing model", async ({
  context,
}) => {
  const state = await loadState();
  const csrfToken = process.env.DOCMOST_CSRF_TOKEN!;
  const testModel = (data: Record<string, unknown>) =>
    context.request.post(
      `/api/spaces/${state.spaceId}/ai/config/actions/test-model`,
      { data, headers: csrfHeaders(csrfToken) },
    );
  const base = {
    baseUrl: process.env.DOCMOST_AI_PROVIDER_BASE_URL,
    chatModel: "docmost-audit-model",
    visionEnabled: false,
  };

  const unsafe = await testModel({
    ...base,
    baseUrl: "http://example.invalid/v1",
  });
  expect(unsafe.status()).toBe(400);
  expect(JSON.stringify(await unsafe.json())).toContain(
    "AI provider hostname cannot be resolved",
  );

  const badKey = await testModel({ ...base, apiKey: "audit-invalid-key" });
  expect(badKey.status()).toBe(502);

  const timeout = await testModel({
    ...base,
    chatModel: "audit-timeout-model",
    requestTimeoutMs: 1000,
  });
  expect(timeout.status()).toBe(504);

  const missingModel = await testModel({
    ...base,
    chatModel: "audit-missing-model",
  });
  expect(missingModel.status()).toBe(201);
  const missingPayload = await missingModel.json();
  expect(missingPayload.data ?? missingPayload).toMatchObject({
    ok: true,
    modelsAvailable: true,
    chatModelAvailable: false,
  });
});
