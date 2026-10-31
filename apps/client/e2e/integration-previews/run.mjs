import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium, firefox, webkit, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";

const root = fileURLToPath(new URL("../..", import.meta.url));
const output = path.resolve(root, "../../artifacts/integration-previews");
process.chdir(root);
await mkdir(output, { recursive: true });
const server = await createServer({
  root,
  mode: "test",
  server: { host: "127.0.0.1", port: 5205, strictPort: true },
});
const results = [];
const errors = [];
try {
  await server.listen();
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const [width, theme] of [
        [1440, "light"],
        [390, "dark"],
      ]) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
        });
        const page = await context.newPage();
        page.on("pageerror", (error) => errors.push(error.message));
        let requests = 0;
        let connected = false;
        await page.route("**/api/integration-previews/**", async (route) => {
          const request = route.request();
          const endpoint = new URL(request.url()).pathname;
          let data;
          if (endpoint.endsWith("/settings"))
            data = {
              enabled: true,
              availableProviders: ["github", "gitlab", "figma"],
            };
          else if (endpoint.endsWith("/actions/resolve")) {
            requests++;
            const { url } = request.postDataJSON();
            data = url.includes("figma.com")
              ? {
                  url,
                  provider: "figma",
                  kind: "file",
                  status: "connectionRequired",
                }
              : {
                  url,
                  provider: "github",
                  kind: "issue",
                  status: requests === 1 ? "ready" : "unavailable",
                  title:
                    requests === 1
                      ? "<script>Private issue</script>"
                      : undefined,
                  state: "open",
                };
          } else if (request.method() === "GET")
            data = connected
              ? [
                  {
                    id: "synthetic-connection",
                    provider: "github",
                    updatedAt: new Date().toISOString(),
                    lastUsedAt: null,
                  },
                ]
              : [];
          else if (request.method() === "PUT") {
            connected = true;
            data = {
              id: "synthetic-connection",
              provider: "github",
              updatedAt: new Date().toISOString(),
              lastUsedAt: null,
            };
          } else {
            connected = false;
            data = { disconnected: true };
          }
          await route.fulfill({ json: { data, status: "success" } });
        });
        try {
          await page.goto(
            `http://127.0.0.1:5205/e2e/integration-previews/fixture.html?theme=${theme}`,
          );
          await page
            .getByRole("button", { name: "Insert GitHub", exact: true })
            .click();
          await page
            .getByRole("dialog")
            .getByRole("button", { name: "Card", exact: true })
            .click();
          const card = page.locator('[data-type="integrationPreview"]');
          await expect(
            card.getByRole("link", {
              name: "<script>Private issue</script>",
              exact: true,
            }),
          ).toBeVisible();
          assert.equal(
            await page
              .locator("script")
              .filter({ hasText: "Private issue" })
              .count(),
            0,
          );
          await page
            .getByRole("textbox", { name: "Find", exact: true })
            .fill("private/project");
          await expect(page.locator('.search-result-current')).toContainText('Private issue');
          await page
            .getByRole("button", { name: "Inspect saved data", exact: true })
            .click();
          await expect(page.getByTestId("saved-data")).toContainText(
            "integrationPreview",
          );
          await expect(page.getByTestId("saved-data")).not.toContainText(
            "Private issue",
          );
          await page.getByRole("button", { name: "Undo", exact: true }).click();
          await expect(card).toHaveCount(0);
          await page.getByRole("button", { name: "Redo", exact: true }).click();
          await expect(card).toHaveCount(1);
          await page
            .getByRole("button", { name: "Switch viewer", exact: true })
            .click();
          await expect(card).not.toContainText("Private issue");
          await expect(card).toContainText(
            "https://github.com/private/project/issues/2",
          );
          await page
            .getByRole("button", { name: "Insert Figma", exact: true })
            .click();
          await expect(
            page.getByRole("link", { name: "Manage connections", exact: true }),
          ).toBeVisible();
          await page
            .getByRole("button", { name: "Public document", exact: true })
            .click();
          await expect(
            page.getByRole("link", { name: "Manage connections", exact: true }),
          ).toHaveCount(0);
          const before = requests;
          await page
            .getByRole("button", { name: "Insert GitHub", exact: true })
            .click();
          await page
            .getByRole("dialog")
            .getByRole("button", { name: "Mention", exact: true })
            .click();
          await expect(
            page.locator('[data-type="integrationMention"]'),
          ).toContainText("https://github.com/private/project/issues/2");
          assert.equal(
            requests,
            before,
            "Public documents never enrich metadata",
          );
          const tokens = page.getByRole("textbox", { name: /Access token/ });
          await tokens.first().fill("synthetic-token");
          await page
            .getByRole("button", { name: "Save token", exact: true })
            .first()
            .click();
          await expect(tokens.first()).toHaveValue("");
          await expect(
            page.getByText("Configured", { exact: true }),
          ).toBeVisible();
          await page
            .getByRole("button", { name: "Disconnect", exact: true })
            .click();
          await expect(
            page.getByText("Configured", { exact: true }),
          ).toHaveCount(0);
          await page.screenshot({
            path: path.join(output, `${name}-${width}-${theme}.png`),
            fullPage: true,
          });
          results.push({ browser: name, width, theme, passed: true });
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await server.close();
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify({ results, errors }, null, 2),
  );
}
console.log(`Integration preview fixture: ${results.length} cases passed.`);
