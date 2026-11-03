import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = fileURLToPath(new URL("../..", import.meta.url));
const output = path.resolve(root, "../../artifacts/editor-blocks-regressions");
const captured = JSON.parse(
  await readFile(
    new URL("./footnote-inline-clipboard.json", import.meta.url),
    "utf8",
  ),
);
const clipboardEntries = captured.entries;
process.chdir(root);
await mkdir(output, { recursive: true });
const server = await createServer({
  root,
  mode: "test",
  server: { host: "127.0.0.1", port: 5203, strictPort: true },
});
const errors = [];
const results = [];
let browser;
let page;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
  });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  const goto = async (theme = "light") => {
    await page.goto(
      `http://127.0.0.1:5203/e2e/editor-blocks/regressions.html?theme=${theme}`,
    );
    await page.waitForFunction(() => window.regressionEditor?.isInitialized);
    await expect(page.locator(".ProseMirror img").first()).toBeVisible();
  };
  await goto();

  // The exact retained HTML must preserve its note through the native paste event.
  for (const type of ["paragraph", "heading"]) {
    await page.evaluate((type) => {
      const editor = window.regressionEditor;
      editor.commands.setContent({
        type: "doc",
        content: [{ type, attrs: type === "heading" ? { level: 2 } : {} }],
      });
      editor.commands.setTextSelection(1);
      editor.view.focus();
    }, type);
    await page.evaluate(async (entries) => {
      await navigator.clipboard.write([
        new ClipboardItem(
          Object.fromEntries(
            entries.map(({ mimeType, text }) => [
              mimeType,
              new Blob([text], { type: mimeType }),
            ]),
          ),
        ),
      ]);
    }, clipboardEntries);
    await page.keyboard.press("Control+v");
    await expect(page.locator('[role="doc-noteref"]')).toHaveText(["1"]);
    await expect(page.locator('[role="doc-endnotes"]')).toContainText(
      "ПРИМЕЧАНИЕ_B",
    );
    const snapshot = await page.evaluate(() =>
      window.regressionEditor.getJSON(),
    );
    assert.equal(snapshot.content[0].content[0].type, "footnote");
    results.push({ nativeCapturedPaste: type, preserved: true });
  }

  await goto();
  const setNotes = async (count = 1) =>
    page.evaluate((count) => {
      const editor = window.regressionEditor;
      editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: Array.from({ length: count }, (_, index) => ({
              type: "footnote",
              attrs: { id: `copy-${index}` },
              content: [{ type: "text", text: `Definition ${index}` }],
            })),
          },
          { type: "paragraph" },
        ],
      });
      editor.view.focus();
    }, count);
  const sourceSelection = async (all = false) =>
    page.evaluate((all) => {
      const editor = window.regressionEditor;
      const paragraph = editor.state.doc.firstChild;
      editor.commands.setTextSelection({
        from: 2,
        to: all ? paragraph.nodeSize - 1 : 1 + paragraph.firstChild.nodeSize,
      });
      editor.view.focus();
    }, all);
  const destination = async () =>
    page.evaluate(() => {
      const editor = window.regressionEditor;
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      editor.view.focus();
    });
  const noteTexts = async () =>
    page.evaluate(() => {
      const entries = [];
      window.regressionEditor.state.doc.descendants((node) => {
        if (node.type.name === "footnote")
          entries.push({ id: node.attrs.id, text: node.textContent });
      });
      return entries;
    });
  for (const action of ["copy", "cut"]) {
    await setNotes();
    await sourceSelection();
    await page.keyboard.press(action === "copy" ? "Control+c" : "Control+x");
    const html = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      return (await items[0].getType("text/html")).text();
    });
    assert(html.includes('data-type="footnote"'));
    assert(
      !html.includes('data-pm-slice="2 1'),
      "Current copy must close the footnote boundary",
    );
    await destination();
    await page.keyboard.press("Control+v");
    const notes = await noteTexts();
    assert.equal(notes.length, action === "copy" ? 2 : 1);
    assert(notes.every((note) => note.text === "Definition 0"));
    assert.equal(new Set(notes.map((note) => note.id)).size, notes.length);
    await page.evaluate(() => window.regressionEditor.commands.undo());
    await page.evaluate(() => window.regressionEditor.commands.redo());
    assert.deepEqual(
      (await noteTexts()).map((note) => note.text),
      notes.map((note) => note.text),
    );
    results.push({
      nativeClipboard: action,
      notes,
      metadata: html.match(/data-pm-slice="([^"]+)/)?.[1],
    });
  }
  await setNotes(2);
  await sourceSelection(true);
  await page.keyboard.press("Control+c");
  await destination();
  await page.keyboard.press("Control+v");
  assert.deepEqual(
    (await noteTexts()).map((note) => note.text),
    ["Definition 0", "Definition 1", "Definition 0", "Definition 1"],
  );
  await page.evaluate(() => {
    window.regressionEditor.commands.selectAll();
    window.regressionEditor.view.focus();
  });
  await page.keyboard.press("Control+c");
  await page.evaluate(() => {
    window.regressionEditor.commands.setContent("<p></p>");
    window.regressionEditor.commands.setTextSelection(1);
    window.regressionEditor.view.focus();
  });
  await page.keyboard.press("Control+v");
  assert.equal((await noteTexts()).length, 4);
  results.push({ nativeClipboard: "two-note and full-body", preserved: true });

  await setNotes();
  await sourceSelection();
  await page.keyboard.press("Control+c");
  await destination();
  await page.keyboard.press("Control+Shift+v");
  assert.equal((await noteTexts()).length, 1);
  await page.evaluate(() => {
    const editor = window.regressionEditor;
    editor.commands.setContent("<pre><code></code></pre>");
    editor.commands.setTextSelection(1);
    editor.view.focus();
  });
  await page.keyboard.press("Control+v");
  assert.equal((await noteTexts()).length, 0);
  results.push({ nativePlainAndCodePaste: "text only" });

  // Enter on the real slash item must hand off native keyboard input to the definition.
  await page.evaluate(() => {
    const editor = window.regressionEditor;
    editor.commands.setContent("<p></p>");
    editor.commands.setTextSelection(1);
    editor.view.focus();
  });
  await page.keyboard.type("/footnote");
  await expect(
    page.getByRole("button", { name: /Footnote/ }).first(),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  const definition = page.locator('[role="doc-endnotes"] textarea');
  await expect(definition).toBeFocused();
  await page.keyboard.type("New definition from keyboard");
  await expect(definition).toHaveValue("New definition from keyboard");
  assert.equal(
    await page.evaluate(() => window.regressionEditor.state.doc.textContent),
    "",
  );
  await page
    .locator('[role="doc-endnotes"]')
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page
    .locator('[role="doc-endnotes"]')
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await expect(definition).toBeFocused();
  await page
    .getByRole("textbox", { name: "Independent input", exact: true })
    .focus();
  await page.evaluate(() =>
    window.regressionEditor.commands.setSearchTerm("definition"),
  );
  await expect(
    page.getByRole("textbox", { name: "Independent input", exact: true }),
  ).toBeFocused();
  await page.evaluate(() => {
    window.regressionEditor.commands.undo();
    window.regressionEditor.commands.redo();
  });
  await expect(
    page.getByRole("textbox", { name: "Independent input", exact: true }),
  ).toBeFocused();
  results.push({ footnoteFocus: "slash Enter, Edit, search and undo/redo" });

  await page
    .locator('[role="doc-endnotes"]')
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Independent input", exact: true })
    .focus();
  await page.evaluate(() => {
    const editor = window.regressionEditor;
    let note;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "footnote") note = { node, position };
    });
    window.dispatchEvent(
      new CustomEvent("docmost:edit-footnote", {
        detail: { editor: {}, id: note.node.attrs.id },
      }),
    );
  });
  await expect(definition).toHaveCount(0);
  await page.evaluate(() => {
    const editor = window.regressionEditor;
    let note;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "footnote") note = { node, position };
    });
    window.dispatchEvent(
      new CustomEvent("docmost:edit-footnote", {
        detail: { editor, id: note.node.attrs.id },
      }),
    );
    editor.commands.deleteRange({
      from: note.position,
      to: note.position + note.node.nodeSize,
    });
  });
  await expect(definition).toHaveCount(0);
  await page.evaluate(() => window.regressionEditor.commands.undo());
  await expect(
    page.getByRole("textbox", { name: "Independent input", exact: true }),
  ).toBeFocused();
  results.push({
    footnoteFocus:
      "foreign editor event ignored; removed note cancels pending handoff before undo",
  });

  await page.evaluate(() => {
    const editor = window.regressionEditor;
    editor.commands.setContent("<p></p>");
    editor.commands.setTextSelection(1);
    editor.view.focus();
  });
  await page.keyboard.type("/heading");
  const menu = page.locator("#slash-command");
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(menu.locator('[data-item-index="1"]')).toHaveClass(
    /selectedItem/,
  );
  await page.keyboard.press("ArrowUp");
  await expect(menu.locator('[data-item-index="0"]')).toHaveClass(
    /selectedItem/,
  );
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const editor = window.regressionEditor;
    editor.commands.setContent("<p></p>");
    editor.commands.setTextSelection(1);
    editor.view.focus();
  });
  await page.keyboard.type("/heading");
  await expect(page.locator("#slash-command")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".ProseMirror > h1")).toHaveCount(1);
  await expect(page.locator("#slash-command")).toHaveCount(0);
  results.push({
    slashKeyboard:
      "ArrowDown, ArrowUp, Escape and Heading Enter without duplicate insertion",
  });

  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await goto(theme);
      for (const mode of ["edit", "read"]) {
        if (mode === "read")
          await page.getByRole("button", { name: "Toggle readonly" }).click();
        const geometry = await page.evaluate(() => {
          const root = document.querySelector(".ProseMirror");
          const tabs = root.querySelector('[data-type="tabs"]');
          const measureTable = (wrapper) => ({
            mode: wrapper.dataset.tableWidthMode,
            width: wrapper.getBoundingClientRect().width,
            available: wrapper.parentElement.getBoundingClientRect().width,
            scrollWidth: wrapper.scrollWidth,
            clientWidth: wrapper.clientWidth,
          });
          const tables = [...tabs.querySelectorAll(".tableWrapper")].map(
            measureTable,
          );
          const topTables = [
            ...root.querySelectorAll(":scope > .tableWrapper"),
          ].map(measureTable);
          const images = [...root.querySelectorAll("img")].map((img) => ({
            width: img.getBoundingClientRect().width,
            height: img.getBoundingClientRect().height,
            wrapper: img.parentElement.getBoundingClientRect().width,
            available:
              img.parentElement.parentElement.getBoundingClientRect().width,
          }));
          const widget = root.querySelector(".ownedWidgetTable");
          return {
            tables,
            topTables,
            images,
            widgetLayout: getComputedStyle(widget).tableLayout,
            widgetCellPadding: getComputedStyle(widget.querySelector("td"))
              .paddingTop,
            preferredImageWidth:
              window.regressionEditor.state.doc.child(2).attrs.width,
          };
        });
        assert.equal(geometry.widgetLayout, "auto");
        assert.equal(geometry.widgetCellPadding, "9px");
        assert.equal(geometry.preferredImageWidth, 720);
        assert.equal(geometry.tables.length, 3);
        assert(
          geometry.tables.every((table) => table.width <= table.available + 1),
        );
        assert.equal(geometry.topTables.length, 3);
        if (width >= 1024) {
          assert(geometry.topTables[1].width > geometry.topTables[0].width);
          assert(geometry.topTables[2].width >= geometry.topTables[1].width);
        } else
          assert(
            geometry.topTables.every(
              (table) => table.width <= geometry.topTables[0].width + 1,
            ),
          );
        assert.equal(geometry.images.length, 2);
        assert(
          geometry.images.every(
            (img) =>
              img.width <= img.available + 1 &&
              img.wrapper <= img.available + 1,
          ),
        );
        assert(
          Math.abs(
            geometry.images[0].width / geometry.images[0].height - 16 / 9,
          ) < 0.01,
        );
        assert(
          Math.abs(
            geometry.images[1].width / geometry.images[1].height - 2 / 3,
          ) < 0.01,
        );
        if (width >= 1024)
          assert(Math.abs(geometry.images[0].width - 720) <= 1);
        results.push({ width, theme, mode, geometry });
      }
      await page.getByRole("button", { name: "Present images" }).click();
      const modal = page.getByRole("dialog");
      await expect(modal.locator("img")).toBeVisible();
      const presentation = await modal.locator("img").evaluate((img) => ({
        image: img.getBoundingClientRect().width,
        available:
          img.parentElement.parentElement.getBoundingClientRect().width,
        ratio:
          img.getBoundingClientRect().width /
          img.getBoundingClientRect().height,
      }));
      assert(presentation.image <= presentation.available + 1);
      assert(Math.abs(presentation.ratio - 16 / 9) < 0.01);
      await page.screenshot({
        path: path.join(output, `presentation-${width}-${theme}.png`),
      });
      await page.keyboard.press("Escape");
      assert.equal(
        await page.evaluate(
          () => window.regressionEditor.state.doc.child(2).attrs.width,
        ),
        720,
      );
      results.push({ width, theme, presentation });
    }
  }

  await page.setViewportSize({ width: 390, height: 900 });
  await goto();
  await page.locator(".ProseMirror img").first().click();
  await expect(page.getByRole("dialog").locator("img")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const align of ["left", "center", "right"]) {
    await page.evaluate((align) => {
      const editor = window.regressionEditor;
      let position;
      editor.state.doc.descendants((node, pos) => {
        if (position === undefined && node.type.name === "image")
          position = pos;
      });
      editor.commands.setNodeSelection(position);
      editor.commands.setImageAlign(align);
      editor.commands.setImageWidth(60);
    }, align);
    await expect
      .poll(() =>
        page
          .locator(".ProseMirror img")
          .first()
          .evaluate(
            (img) =>
              img.parentElement.getBoundingClientRect().width /
              img.parentElement.parentElement.getBoundingClientRect().width,
          ),
      )
      .toBeCloseTo(0.6, 1);
    const attrs = await page.evaluate(
      () => window.regressionEditor.state.doc.child(2).attrs,
    );
    assert.equal(attrs.width, "60%");
    assert.equal(attrs.align, align);
  }
  await page.evaluate(() => {
    const editor = window.regressionEditor;
    editor.commands.updateAttributes("image", {
      src: "",
      width: 720,
      placeholder: { id: "upload", name: "Pending image.png" },
    });
  });
  const placeholder = page.getByText("Pending image.png", { exact: false });
  await expect(placeholder).toBeVisible();
  const upload = await placeholder.evaluate((element) => {
    const wrapper = element.closest(
      "[data-node-view-wrapper]",
    ).firstElementChild;
    return {
      width: wrapper.getBoundingClientRect().width,
      available: wrapper.parentElement.getBoundingClientRect().width,
    };
  });
  assert(upload.width <= upload.available + 1);
  results.push({
    responsiveImageActions:
      "lightbox, explicit percent resize, all alignments and upload placeholder",
    upload,
  });
  assert.deepEqual(errors, []);
  console.log(
    `Editor regressions passed: ${results.length} clipboard, focus and layout cases.`,
  );
} catch (error) {
  await page
    ?.screenshot({ path: path.join(output, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await writeFile(
    path.join(output, "results.json"),
    JSON.stringify({ errors, results }, null, 2),
  );
  await browser?.close();
  await server.close();
}
