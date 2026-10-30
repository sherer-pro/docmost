import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";

const root = fileURLToPath(new URL("../..", import.meta.url));
const output = path.resolve(root, "../../artifacts/editor-blocks");
process.chdir(root);
await mkdir(output, { recursive: true });
const server = await createServer({
  root,
  mode: "test",
  server: { host: "127.0.0.1", port: 5203, strictPort: true },
});
let browser;
let page;
const errors = [];
const results = [];
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 390]) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width, height: 850 },
      });
      page = await context.newPage();
      page.on("pageerror", (error) =>
        errors.push(error.stack ?? error.message),
      );
      await page.goto(
        `http://127.0.0.1:5203/e2e/editor-blocks/fixture.html?theme=${theme}`,
      );
      const footer = page.locator('[role="doc-endnotes"]');
      await expect(footer).toContainText("First canonical note");
      await expect(page.locator('[role="doc-noteref"]')).toHaveText(["1"]);
      await footer.getByRole("button", { name: "Edit", exact: true }).click();
      await footer.getByRole("textbox").fill("Edited canonical note");
      await footer.getByRole("button", { name: "Save", exact: true }).click();
      await expect(footer).toContainText("Edited canonical note");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await expect(footer).toContainText("First canonical note");
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      await expect(footer).toContainText("Edited canonical note");
      await page
        .getByRole("textbox", { name: "Find", exact: true })
        .fill("canonical");
      await expect(footer.locator("mark")).toHaveText("canonical");
      for (const [text, direction] of [
        ["Русский English العربية", "ltr"],
        ["مرحبا English русский", "rtl"],
        ["שלום English", "rtl"],
        ["العربية English", "rtl"],
        ["English русский", "ltr"],
      ]) {
        await expect(
          page
            .locator(".tiptap p")
            .filter({ hasText: new RegExp(`^${text}$`) }),
        ).toHaveCSS("direction", direction);
      }
      await page.screenshot({
        path: path.join(output, `footnotes-${width}-${theme}.png`),
      });
      results.push({
        width,
        theme,
        footnotes: "passed",
        mixedDirection: "passed",
      });
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    "Footnote reading, editing, undo/redo, search and null-editor lifecycle passed in both themes and sizes.",
  );
} catch (error) {
  await page
    ?.screenshot({ path: path.join(output, "failure.png") })
    .catch(() => {});
  console.error(JSON.stringify(errors, null, 2));
  throw error;
} finally {
  await writeFile(
    path.join(output, "results.json"),
    JSON.stringify({ errors, results }, null, 2),
  );
  await browser?.close();
  await server.close();
}
