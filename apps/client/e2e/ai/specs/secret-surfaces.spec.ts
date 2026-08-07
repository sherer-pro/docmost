import fs from "node:fs/promises";
import path from "node:path";
import { auditRoot, expect, loadState, openAssistant, test } from "../support";

function unwrap(payload: unknown): unknown {
  if (
    payload &&
    typeof payload === "object" &&
    "success" in payload &&
    "data" in payload
  ) {
    return (payload as { data: unknown }).data;
  }
  return payload;
}

function forbiddenCredentialFields(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const property = prefix ? `${prefix}.${key}` : key;
    const normalized = key.toLowerCase();
    const own =
      normalized.includes("encrypted") ||
      normalized === "apikey" ||
      normalized === "api_key"
        ? [property]
        : [];
    return [...own, ...forbiddenCredentialFields(child, property)];
  });
}

test("provider credentials stay out of API, HTML and browser storage", async ({
  page,
}) => {
  const state = await loadState();
  const canary = process.env.DOCMOST_AUDIT_CANARY;
  const authToken = process.env.DOCMOST_AUTH_TOKEN;
  const csrfToken = process.env.DOCMOST_CSRF_TOKEN;
  expect(canary).toBeTruthy();
  await openAssistant(page, state);

  const response = await page.request.get(`/api/spaces/${state.spaceId}/ai/config`);
  expect(response.ok()).toBe(true);
  const responseText = await response.text();
  expect(responseText).not.toContain(canary);
  expect(responseText).not.toContain(authToken);
  expect(responseText).not.toContain(csrfToken);
  const publicConfig = unwrap(JSON.parse(responseText));
  const forbiddenFields = forbiddenCredentialFields(publicConfig);
  expect(forbiddenFields).toEqual([]);
  expect(publicConfig).toMatchObject({ apiKeyConfigured: true });

  const html = await page.content();
  expect(html).not.toContain(canary);
  expect(html).not.toContain(authToken);
  expect(html).not.toContain(csrfToken);

  const browserStorage = await page.evaluate(() => ({
    localStorage: Object.fromEntries(Object.entries(localStorage)),
    sessionStorage: Object.fromEntries(Object.entries(sessionStorage)),
  }));
  const serializedStorage = JSON.stringify(browserStorage);
  expect(serializedStorage).not.toContain(canary);
  expect(serializedStorage).not.toContain(authToken);
  expect(serializedStorage).not.toContain(csrfToken);
  expect(serializedStorage).not.toMatch(
    /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  );

  await fs.writeFile(
    path.join(auditRoot, "security-surfaces.json"),
    `${JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        publicConfigApiKeyConfigured:
          (publicConfig as { apiKeyConfigured?: boolean }).apiKeyConfigured ===
          true,
        forbiddenCredentialFields: forbiddenFields,
        htmlChecked: true,
        localStorageChecked: true,
        sessionStorageChecked: true,
      },
      null,
      2,
    )}\n`,
  );
});
