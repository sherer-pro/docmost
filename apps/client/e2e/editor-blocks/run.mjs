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
      const tabs = page.locator("[data-docmost-tabs-scope]");
      await expect(
        tabs.getByText("First tab body", { exact: true }),
      ).toBeVisible();
      await expect(
        tabs.getByText("Hidden tab evidence", { exact: true }),
      ).toBeHidden();
      await page
        .getByRole("button", { name: "Find hidden tab", exact: true })
        .click();
      await expect(
        tabs.getByRole("tab", { name: "Details", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await tabs.getByRole("tab", { name: "Overview", exact: true }).click();
      await tabs.getByRole("tab", { name: "Overview", exact: true }).focus();
      await page.keyboard.press("Control+End");
      await expect(
        tabs.getByRole("tab", { name: "Overview", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("ArrowRight");
      await expect(
        tabs.getByRole("tab", { name: "Details", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("ArrowLeft");
      await page.evaluate(() => {
        window.location.hash = "tab-two";
      });
      await expect(
        tabs.getByRole("tab", { name: "Details", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await page
        .getByRole("textbox", { name: "Find", exact: true })
        .fill("Hidden tab evidence");
      await expect(tabs.locator(".search-result-current")).toBeVisible();
      await expect(
        tabs.getByRole("tab", { name: "Details", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await tabs
        .getByRole("button", { name: "Tab actions", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
      const rename = page.getByRole("dialog", { name: "Rename", exact: true });
      await rename
        .getByRole("textbox", { name: "Name", exact: true })
        .fill("Renamed tab");
      await rename.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        tabs.getByRole("tab", { name: "Renamed tab", exact: true }),
      ).toBeVisible();
      await tabs
        .getByRole("button", { name: "Tab actions", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "Duplicate", exact: true })
        .click();
      await expect(tabs.getByRole("tab")).toHaveCount(3);
      await tabs
        .getByRole("button", { name: "Tab actions", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "Move tab left", exact: true })
        .click();
      await expect(tabs.getByRole("tab").nth(1)).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await tabs
        .getByRole("button", { name: "Tab actions", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "Delete tab", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "Delete tab", exact: true })
        .getByRole("button", { name: "Delete", exact: true })
        .click();
      await expect(tabs.getByRole("tab")).toHaveCount(2);
      await tabs.getByRole("button", { name: "Add tab", exact: true }).click();
      await expect(tabs.getByRole("tab")).toHaveCount(3);
      await expect(
        tabs.getByRole("tab", { name: "Tab 3", exact: true }),
      ).toBeInViewport();
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
      await expect(
        page.locator(".tiptap li").filter({ hasText: "שלום English" }),
      ).toHaveCSS("direction", "rtl");
      await page
        .getByRole("button", { name: "Present fixture", exact: true })
        .click();
      const presentation = page.getByRole("dialog", {
        name: "Present page",
        exact: true,
      });
      await expect(
        presentation.getByRole("heading", { name: "First slide", exact: true }),
      ).toBeVisible();
      await expect(
        presentation.locator('[contenteditable="true"]'),
      ).toHaveCount(0);
      await expect(presentation.locator("[data-comment-id]")).toHaveCount(0);
      await presentation
        .getByRole("button", { name: "Next slide", exact: true })
        .click();
      const long = presentation.getByRole("region", {
        name: "Slide 2 of 3",
        exact: true,
      });
      assert(
        await long.evaluate(
          (element) => element.scrollHeight > element.clientHeight,
        ),
        "Long slides must scroll",
      );
      await page.keyboard.press("End");
      await expect(
        presentation.getByRole("heading", { name: "Last slide", exact: true }),
      ).toBeVisible();
      await expect(
        presentation.getByRole("button", { name: "Add tab", exact: true }),
      ).toHaveCount(0);
      await presentation.getByRole("tab", { name: "Two", exact: true }).click();
      await expect(
        presentation.getByText("Second presentation tab", { exact: true }),
      ).toBeVisible();
      await presentation
        .getByRole("button", { name: "Pointer", exact: true })
        .click();
      await page.mouse.move(160, 160);
      await expect(
        presentation.locator("[data-presentation-pointer]"),
      ).toBeVisible();
      const fullscreen = presentation.getByRole("button", {
        name: "Full screen",
        exact: true,
      });
      const fullscreenSupported = await fullscreen.isEnabled();
      if (fullscreenSupported) {
        await fullscreen.click();
        await expect
          .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
          .toBe(true);
        await page.keyboard.press("Escape");
        await expect
          .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
          .toBe(false);
        await expect(presentation).toBeVisible();
      }
      await page.screenshot({
        path: path.join(output, `presentation-${width}-${theme}.png`),
      });
      await presentation
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await expect(presentation).toHaveCount(0);
      await page.screenshot({
        path: path.join(output, `footnotes-${width}-${theme}.png`),
      });
      results.push({
        width,
        theme,
        footnotes: "passed",
        mixedDirection: "passed",
        tabs: "passed",
        presentation: "passed",
        fullscreen: fullscreenSupported ? "passed" : "unavailable",
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
