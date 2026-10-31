import { editorClipboard } from "../../database/editor-clipboard";
import {
  apiGet,
  apiPost,
  attachmentUrl,
  createAdminApi,
  createPage,
  deletePage,
  loadAuditState,
  tinySvg,
  updatePageContent,
  uploadFixture,
} from "../support/api";
import { pageUrl } from "../support/complex-document";
import { captureStep, expect, mainEditor, test } from "../support/audit-test";

test("Draw.io copies detach within and across pages without changing source bytes", async ({
  page,
}, testInfo) => {
  const api = await createAdminApi();
  const state = await loadAuditState();
  const current = await apiGet<any>(api, "/api/users/me");
  const original = current.user.settings?.preferences ?? {};
  const pages: any[] = [];
  const nodeIds = async (pageId: string) => {
    const saved = await apiGet<any>(
      api,
      `/api/pages/info?pageId=${encodeURIComponent(pageId)}`,
    );
    const ids: string[] = [];
    const visit = (node: any) => {
      if (node?.type === "drawio") ids.push(node.attrs.attachmentId);
      for (const child of node?.content ?? []) visit(child);
    };
    visit(saved.content);
    return ids;
  };
  const saveCopy = async (index: number, label: string) => {
    await page
      .getByAltText("Draw.io preserved source", { exact: true })
      .nth(index)
      .dblclick();
    await expect(page.locator("iframe.diagrams-iframe")).toBeVisible();
    await page.evaluate((value) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><text x="8" y="40">${value}</text></svg>`;
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
    }, label);
    await expect(page.locator("iframe.diagrams-iframe")).toHaveCount(0);
  };
  try {
    const source = await createPage(
      api,
      state.spaceId,
      `${testInfo.project.name} Draw.io source`,
    );
    const target = await createPage(
      api,
      state.spaceId,
      `${testInfo.project.name} Draw.io destination`,
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Destination anchor" }],
          },
        ],
      },
    );
    pages.push(source, target);
    const originalBytes = tinySvg();
    const attachment = await uploadFixture(
      api,
      source.id,
      "preserved-source.svg",
      "image/svg+xml",
      originalBytes,
    );
    await updatePageContent(api, source.id, {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Source anchor" }],
        },
        {
          type: "drawio",
          attrs: {
            src: attachmentUrl(attachment),
            attachmentId: attachment.id,
            title: "Draw.io preserved source",
            width: "100%",
            widthMode: "normal",
            align: "center",
          },
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Source paste target" }],
        },
      ],
    });
    await apiPost(api, "/api/users/update", {
      pageEditModeByPageId: {
        ...(original.pageEditModeByPageId ?? {}),
        [source.id]: "edit",
        [target.id]: "edit",
      },
    });
    await page.goto(pageUrl(state, source));
    const editor = mainEditor(page);
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await page
      .getByAltText("Draw.io preserved source", { exact: true })
      .click();
    const clipboard = await editorClipboard(editor, "copy");
    expect(clipboard["text/html"]).toMatch(/drawio/);
    await editor.getByText("Source paste target", { exact: true }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await editorClipboard(editor, "paste", clipboard);
    await expect(
      page.getByAltText("Draw.io preserved source", { exact: true }),
    ).toHaveCount(2);
    await saveCopy(1, "Same page copy revision");
    await expect
      .poll(async () => new Set(await nodeIds(source.id)).size)
      .toBe(2);
    const sourceIds = await nodeIds(source.id);
    expect(sourceIds[0]).toBe(attachment.id);
    const samePageCopyUrl = await editor
      .locator(`img[src*="/${sourceIds[1]}/"]`)
      .getAttribute("src");
    expect(samePageCopyUrl).toContain("/api/attachments/files/");

    await page.goto(pageUrl(state, target));
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await editor.getByText("Destination anchor", { exact: true }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await editorClipboard(editor, "paste", clipboard);
    await expect(
      page.getByAltText("Draw.io preserved source", { exact: true }),
    ).toHaveCount(1);
    await saveCopy(0, "Cross page copy revision");
    await expect
      .poll(async () => {
        const ids = await nodeIds(target.id);
        return ids.length === 1 && !sourceIds.includes(ids[0]);
      })
      .toBe(true);
    expect(await nodeIds(source.id)).toEqual(sourceIds);
    const originalFile = await api.get(attachmentUrl(attachment));
    expect(originalFile.ok()).toBe(true);
    expect(await originalFile.body()).toEqual(originalBytes);
    const samePageFile = await api.get(samePageCopyUrl!);
    expect(samePageFile.ok()).toBe(true);
    expect(await samePageFile.text()).toContain("Same page copy revision");
    const targetIds = await nodeIds(target.id);
    const targetImage = editor.locator(`img[src*="/${targetIds[0]}/"]`);
    const targetCopyUrl = await targetImage.getAttribute("src");
    expect(targetCopyUrl).toContain("/api/attachments/files/");
    const targetFile = await api.get(targetCopyUrl!);
    expect(targetFile.ok()).toBe(true);
    expect(await targetFile.text()).toContain("Cross page copy revision");
    await page.reload();
    await expect(targetImage).toBeVisible();
    expect(await nodeIds(target.id)).toEqual(targetIds);
    await captureStep(page, testInfo, "drawio-cross-page-source-preserved");
  } finally {
    await page.goto("about:blank").catch(() => undefined);
    await apiPost(api, "/api/users/update", {
      pageEditModeByPageId: original.pageEditModeByPageId ?? {},
    }).catch(() => undefined);
    for (const item of pages.reverse())
      await deletePage(api, item.id).catch(() => undefined);
    await api.dispose();
  }
});
