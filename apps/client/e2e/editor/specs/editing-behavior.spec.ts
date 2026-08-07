import fs from "node:fs/promises";
import path from "node:path";
import {
  attachmentUrl,
  apiGet,
  apiPost,
  createAdminApi,
  createPage,
  loadAuditState,
  tinySvg,
  updatePageContent,
  uploadFixture,
} from "../support/api";
import { pageUrl } from "../support/complex-document";
import {
  captureStep,
  expect,
  mainEditor,
  recordDefect,
  runAxe,
  test,
} from "../support/audit-test";

test("supports keyboard indent, page breaks, tables, slash commands, paste and undo redo", async ({
  page,
}, testInfo) => {
  const api = await createAdminApi();
  const state = await loadAuditState();
  const current = await apiGet<any>(api, "/api/users/me");
  const original = current.user.settings?.preferences ?? {};
  const editingContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { indent: 0 },
        content: [{ type: "text", text: "Keyboard indentation target" }],
      },
      {
        type: "table",
        attrs: { widthMode: "normal" },
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "A1" }],
                  },
                ],
              },
              {
                type: "tableCell",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "B1" }],
                  },
                ],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "A2" }],
                  },
                ],
              },
              {
                type: "tableCell",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "B2" }],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Paste and undo anchor" }],
      },
    ],
  };
  const auditPage = await createPage(
    api,
    state.spaceId,
    `${testInfo.project.name} editing operations`,
    editingContent,
  );
  const drawioAttachment = await uploadFixture(
    api,
    auditPage.id,
    "editable-drawio.svg",
    "image/svg+xml",
    tinySvg(),
  );
  await updatePageContent(api, auditPage.id, {
    ...editingContent,
    content: [
      ...editingContent.content,
      {
        type: "drawio",
        attrs: {
          src: attachmentUrl(drawioAttachment),
          title: "Editable Draw.io copy target",
          attachmentId: drawioAttachment.id,
          width: "100%",
          widthMode: "normal",
          align: "center",
        },
      },
    ],
  });

  try {
    await apiPost(api, "/api/users/update", {
      fixedToolbar: true,
      pageEditModeByPageId: {
        ...(original.pageEditModeByPageId ?? {}),
        [auditPage.id]: "edit",
      },
    });
    const persistedPreferences = (await apiGet<any>(api, "/api/users/me")).user
      .settings?.preferences;
    expect(persistedPreferences?.fixedToolbar).toBe(true);
    expect(persistedPreferences?.pageEditModeByPageId?.[auditPage.id]).toBe(
      "edit",
    );
    await page.goto(pageUrl(state, auditPage));
    const editor = mainEditor(page);
    await expect(editor).toHaveAttribute("contenteditable", "true");
    const fixedToolbar = page.getByRole("toolbar");
    await expect(fixedToolbar).toBeVisible();
    const toolbarButtons = fixedToolbar.getByRole("button");
    expect(await toolbarButtons.count()).toBeGreaterThan(8);
    await toolbarButtons.first().focus();
    await page.keyboard.press("Tab");
    await expect(toolbarButtons.nth(1)).toBeFocused();
    const tablePasteAnchor = editor.getByText("Paste and undo anchor", {
      exact: true,
    });
    await tablePasteAnchor.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData(
        "text/html",
        "<table><tbody><tr><td><p>PA1</p></td><td><p>PB1</p></td></tr><tr><td><p>PA2</p></td><td><p>PB2</p></td></tr></tbody></table><p>Pasted table result</p>",
      );
      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(pasteEvent, "clipboardData", {
        value: data,
      });
      document.activeElement?.dispatchEvent(pasteEvent);
    });
    await expect(editor).toContainText("Keyboard indentation target");
    await expect(editor).toContainText("Pasted table result");
    await expect(editor.locator("table")).toHaveCount(2);

    const indentTarget = editor.getByText("Keyboard indentation target", {
      exact: true,
    });
    await indentTarget.click();
    await page.keyboard.press("Tab");
    const tabIndented =
      (await indentTarget.getAttribute("data-indent")) === "1";
    if (!tabIndented) {
      await indentTarget.click();
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      await page
        .getByRole("button", { name: /Indent|Увеличить отступ/ })
        .click();
      const toolbarIndented =
        (await indentTarget.getAttribute("data-indent")) === "1";
      await recordDefect({
        id: "ED-002",
        title: "Tab does not indent an editable paragraph",
        severity: "high",
        project: testInfo.project.name,
        evidence: toolbarIndented
          ? "The focused paragraph remained at indent level 0 after a trusted Tab key press; the fixed-toolbar command worked on the selected paragraph."
          : "The focused paragraph remained at indent level 0 after a trusted Tab key press; the fixed-toolbar Indent command also left it unchanged.",
      });
    }
    if ((await indentTarget.getAttribute("data-indent")) === "1") {
      await indentTarget.click();
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      await page.keyboard.press("Shift+Tab");
      await expect(indentTarget).not.toHaveAttribute("data-indent", "1");
    }

    const pageBreaks = page.locator(".page-break, [data-type='pageBreak']");
    const beforeBreaks = await pageBreaks.count();
    await indentTarget.click();
    await page
      .getByRole("button", { name: /Page break|Разрыв страницы/ })
      .click();
    await expect(pageBreaks).toHaveCount(beforeBreaks + 1);
    await pageBreaks.last().click();
    await page.evaluate(() => {
      (window as any).__editorAuditCopy = null;
      document.addEventListener(
        "copy",
        (event) => {
          const clipboardEvent = event as ClipboardEvent;
          (window as any).__editorAuditCopy = {
            html: clipboardEvent.clipboardData?.getData("text/html") ?? "",
            text: clipboardEvent.clipboardData?.getData("text/plain") ?? "",
          };
        },
        { once: true },
      );
    });
    await page.keyboard.press("Control+c");
    const copiedBreak = await page.evaluate(
      () => (window as any).__editorAuditCopy as { html: string; text: string },
    );
    expect(copiedBreak.html).toMatch(/page-break|data-type="pageBreak"/);
    await page.keyboard.press("Delete");
    await expect(pageBreaks).toHaveCount(beforeBreaks);

    const editableTable = editor.locator("table").first();
    await editableTable.locator("td p").first().click();
    const addColumn = page.getByRole("button", {
      name: /Add right column|Добавить столбец справа/,
    });
    if (await addColumn.isVisible().catch(() => false)) {
      await addColumn.click();
      await expect(
        editableTable.locator("tr").first().locator("th, td"),
      ).toHaveCount(3);
      await editor.getByText("A1", { exact: true }).click();
      await page
        .getByRole("button", { name: /Add row below|Добавить строку ниже/ })
        .click();
      await expect(editableTable.locator("tr")).toHaveCount(3);
      await editor.getByText("A1", { exact: true }).click();
      await page
        .getByRole("button", { name: /Delete row|Удалить строку/ })
        .click();
      await expect(editableTable.locator("tr")).toHaveCount(2);
      await editor.getByText("A2", { exact: true }).click();
      await page
        .getByRole("button", { name: /Delete column|Удалить столбец/ })
        .click();
      await expect(
        editableTable.locator("tr").first().locator("th, td"),
      ).toHaveCount(2);
      const firstRowCells = editableTable
        .locator("tr")
        .first()
        .locator("th, td");
      await firstRowCells.nth(0).locator("p").click();
      await page.keyboard.down("Shift");
      await firstRowCells.nth(1).locator("p").click();
      await page.keyboard.up("Shift");
      const mergeCells = page.getByRole("button", {
        name: /Merge cells|Объединить ячейки/,
      });
      if (await mergeCells.isVisible().catch(() => false)) {
        await mergeCells.click();
        if ((await firstRowCells.count()) !== 1) {
          await recordDefect({
            id: "ED-004",
            title: "Table merge action does not merge the selected cells",
            severity: "medium",
            project: testInfo.project.name,
            evidence:
              "The Merge cells action was available for a trusted Shift+click cell selection, but the selected row still contained two cells after activation.",
          });
        }
      } else {
        await recordDefect({
          id: "ED-004",
          title:
            "Table cell merge controls do not appear for a pointer cell selection",
          severity: "medium",
          project: testInfo.project.name,
          evidence:
            "Trusted Shift+click across adjacent table cells did not expose the Merge cells action.",
        });
      }
    } else {
      await recordDefect({
        id: "ED-003",
        title: "Table contextual editing controls do not appear",
        severity: "high",
        project: testInfo.project.name,
        evidence:
          "Clicking an editable table cell did not expose add/remove row or column controls.",
      });
    }
    await expect(editor.locator(".column-resize-handle")).toHaveCount(0);
    await recordDefect({
      id: "ED-005",
      title: "Table column resizing is disabled",
      severity: "medium",
      project: testInfo.project.name,
      evidence:
        "No resize handle is rendered in edit mode; the client configures CustomTable with resizable: false.",
    });

    const drawioImages = page.getByAltText("Editable Draw.io copy target");
    await expect(drawioImages).toHaveCount(1);
    await drawioImages.first().click();
    await page.evaluate(() => {
      (window as any).__editorAuditDiagramCopy = null;
      document.addEventListener(
        "copy",
        (event) => {
          const clipboardEvent = event as ClipboardEvent;
          (window as any).__editorAuditDiagramCopy = {
            html: clipboardEvent.clipboardData?.getData("text/html") ?? "",
            text: clipboardEvent.clipboardData?.getData("text/plain") ?? "",
          };
        },
        { once: true },
      );
    });
    await page.keyboard.press("Control+c");
    const copiedDrawio = await page.evaluate(
      () =>
        (window as any).__editorAuditDiagramCopy as {
          html: string;
          text: string;
        },
    );
    expect(copiedDrawio.html).toMatch(/drawio|data-type="drawio"/i);
    const pasteAnchor = editor.getByText("Paste and undo anchor", {
      exact: true,
    });
    await pasteAnchor.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.evaluate((clipboard) => {
      const data = new DataTransfer();
      data.setData("text/html", clipboard.html);
      data.setData("text/plain", clipboard.text);
      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(pasteEvent, "clipboardData", {
        value: data,
      });
      document.activeElement?.dispatchEvent(pasteEvent);
    }, copiedDrawio);
    await expect(drawioImages).toHaveCount(2);
    await drawioImages.nth(1).dblclick();
    await expect(page.locator("iframe.diagrams-iframe")).toBeVisible();
    await page.evaluate(() => {
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#228be6"/></svg>';
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://embed.diagrams.net",
          data: JSON.stringify({
            event: "export",
            data: `data:image/svg+xml;base64,${btoa(svg)}`,
            message: { parentEvent: "save" },
          }),
        }),
      );
    });
    await expect(page.locator("iframe.diagrams-iframe")).toHaveCount(0);
    let drawioAttachmentIds: string[] = [];
    await expect
      .poll(
        async () => {
          const savedPage = await apiGet<any>(
            api,
            `/api/pages/info?pageId=${encodeURIComponent(auditPage.id)}`,
          );
          drawioAttachmentIds = [];
          const visit = (node: any) => {
            if (node?.type === "drawio" && node.attrs?.attachmentId) {
              drawioAttachmentIds.push(node.attrs.attachmentId);
            }
            for (const child of node?.content ?? []) visit(child);
          };
          visit(savedPage.content);
          return drawioAttachmentIds.length;
        },
        { timeout: 15_000 },
      )
      .toBe(2);
    expect(new Set(drawioAttachmentIds).size).toBe(2);

    const anchor = editor.getByText("Paste and undo anchor", { exact: true });
    await anchor.click();
    await page.keyboard.press("End");
    const largeMarkdown = Array.from(
      { length: 120 },
      (_, index) => `\n\n## Pasted section ${index + 1}\n\n- item ${index + 1}`,
    ).join("");
    await page.evaluate((payload) => {
      const data = new DataTransfer();
      data.setData("text/plain", payload);
      data.setData("text/markdown", payload);
      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(pasteEvent, "clipboardData", {
        value: data,
      });
      document.activeElement?.dispatchEvent(pasteEvent);
    }, largeMarkdown);
    await expect(editor).toContainText("Pasted section 120");

    const maliciousHtml = await fs.readFile(
      path.resolve(process.cwd(), "e2e/editor/fixtures/html-malicious.html"),
      "utf8",
    );
    await page.evaluate((payload) => {
      const data = new DataTransfer();
      data.setData("text/html", payload);
      data.setData("text/plain", "Safe pasted HTML Unsafe link label");
      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(pasteEvent, "clipboardData", {
        value: data,
      });
      document.activeElement?.dispatchEvent(pasteEvent);
    }, maliciousHtml);
    await expect(editor).toContainText("Safe pasted HTML");
    expect(await editor.locator("script, [onerror], [onclick]").count()).toBe(
      0,
    );
    expect(await editor.locator("a[href^='javascript:']").count()).toBe(0);
    expect(
      await page.evaluate(() => (window as any).__editorAuditHtmlXss ?? null),
    ).toBeNull();

    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" undo-redo-probe");
    await expect(editor).toContainText("undo-redo-probe");
    await page.keyboard.press("Control+z");
    await expect(editor).not.toContainText("undo-redo-probe");
    await page.keyboard.press("Control+Shift+z");
    await expect(editor).toContainText("undo-redo-probe");

    await page.keyboard.press("Enter");
    await page.keyboard.type("/");
    await expect(page.getByText("To-do list", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await runAxe(page, testInfo, "body");
    await captureStep(page, testInfo, "03-fixed-toolbar-editing");

    await apiPost(api, "/api/users/update", {
      fixedToolbar: false,
      pageEditModeByPageId: {
        ...(original.pageEditModeByPageId ?? {}),
        [auditPage.id]: "edit",
      },
    });
    await page.reload();
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await expect(editor).toContainText("undo-redo-probe");
    await expect(page.getByRole("toolbar")).toHaveCount(0);
    await captureStep(page, testInfo, "03b-unfixed-toolbar-editing");
  } finally {
    await apiPost(api, "/api/users/update", {
      fixedToolbar: original.fixedToolbar ?? false,
      pageEditModeByPageId: original.pageEditModeByPageId ?? {},
    }).catch(() => undefined);
    await api.dispose();
  }
});
