import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { generateJitteredKeyBetween } from "fractional-indexing-jittered";
import {
  apiGet,
  apiPost,
  createAdminApi,
  createPage,
  hashProseMirrorJson,
  loadAuditState,
  parseResponse,
  tinyPng,
  updatePageContent,
  uploadFixture,
} from "../support/api";
import { pageUrl } from "../support/complex-document";
import { baseUrl } from "../support/auth";
import { downloadsDir } from "../support/paths";
import {
  captureStep,
  expect,
  mainEditor,
  publicDocument,
  test,
} from "../support/audit-test";
import {
  provisionAuditMember,
  removeAuditMember,
  type AuditMember,
} from "../support/member";

type PageInfo = {
  id: string;
  slugId: string;
  title: string;
  spaceId: string;
  content: Record<string, unknown>;
};

const paragraph = (value?: string) => ({
  type: "paragraph",
  ...(value ? { content: [{ type: "text", text: value }] } : {}),
});

async function makeEditable(page: import("@playwright/test").Page) {
  const editor = mainEditor(page);
  if ((await editor.getAttribute("contenteditable")) === "true") return;
  await page
    .getByRole("radiogroup")
    .getByText(/^Edit$/)
    .click();
  await expect(editor).toHaveAttribute("contenteditable", "true");
}

async function closeOverlayAside(page: import("@playwright/test").Page) {
  const aside = page.locator("#docmost-context-aside");
  if (!(await aside.isVisible())) return;

  const closeButton = aside.getByRole("button", {
    name: /Close panel|Закрыть панель/i,
  });
  await expect(closeButton).toBeVisible();
  await closeButton.click();
  await expect(aside).not.toBeVisible();
}

function collectNodeTypes(
  input: unknown,
  result = new Set<string>(),
): Set<string> {
  if (!input || typeof input !== "object") return result;
  const node = input as { type?: unknown; content?: unknown[] };
  if (typeof node.type === "string") result.add(node.type);
  for (const child of node.content ?? []) collectNodeTypes(child, result);
  return result;
}

test("audits synced block creation, lookup recovery, ACL, clipboard and unsync", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const api = await createAdminApi();
  const state = await loadAuditState();
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const ids = {
    text: randomUUID(),
    list: randomUUID(),
    table: randomUUID(),
    media: randomUUID(),
    diagram: randomUUID(),
  };
  let member: AuditMember | undefined;
  let memberSourcePage: import("@playwright/test").Page | undefined;
  let memberConsumerPage: import("@playwright/test").Page | undefined;
  let publicContext: import("@playwright/test").BrowserContext | undefined;
  let shareId: string | undefined;
  const currentUser = await apiGet<any>(api, "/api/users/me");
  const originalLocale = currentUser.user.locale;
  const originalPreferences = currentUser.user.settings?.preferences ?? {};

  try {
    const consumer = await createPage(
      api,
      state.spaceId,
      `Synced consumer ${suffix}`,
    );
    const source = await createPage(
      api,
      state.spaceId,
      `Synced source ${suffix}`,
      { type: "doc", content: [paragraph()] },
      consumer.id,
    );
    const moveTarget = await createPage(
      api,
      state.spaceId,
      `Move target ${suffix}`,
    );
    const deniedConsumer = await createPage(
      api,
      state.spaceId,
      `Denied unsync consumer ${suffix}`,
    );
    const workflowPage = await createPage(
      api,
      state.spaceId,
      `Synced workflow ${suffix}`,
      {
        type: "doc",
        content: [paragraph(`Selection workflow ${suffix}`), paragraph()],
      },
    );
    const image = await uploadFixture(
      api,
      source.id,
      "synced-audit.png",
      "image/png",
      tinyPng(),
    );
    const sourceContent = {
      type: "doc",
      content: [
        {
          type: "transclusionSource",
          attrs: { id: ids.text },
          content: [paragraph(`Shared text ${suffix}`)],
        },
        {
          type: "transclusionSource",
          attrs: { id: ids.list },
          content: [
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [paragraph(`Shared list ${suffix}`)],
                },
              ],
            },
          ],
        },
        {
          type: "transclusionSource",
          attrs: { id: ids.table },
          content: [
            {
              type: "table",
              content: [
                {
                  type: "tableRow",
                  content: [
                    {
                      type: "tableCell",
                      content: [paragraph(`Shared table ${suffix}`)],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "transclusionSource",
          attrs: { id: ids.media },
          content: [
            {
              type: "image",
              attrs: {
                src: `/api/attachments/files/${image.id}/synced-audit.png`,
                attachmentId: image.id,
                alt: `Shared media ${suffix}`,
              },
            },
          ],
        },
        {
          type: "transclusionSource",
          attrs: { id: ids.diagram },
          content: [
            {
              type: "codeBlock",
              attrs: { language: "mermaid" },
              content: [
                {
                  type: "text",
                  text: `flowchart LR\n A[Shared diagram ${suffix}] --> B[Done]`,
                },
              ],
            },
          ],
        },
      ],
    };
    await updatePageContent(api, source.id, sourceContent);
    const references = Object.values(ids).map((transclusionId) => ({
      type: "transclusionReference",
      attrs: { sourcePageId: source.id, transclusionId },
    }));
    await updatePageContent(api, consumer.id, {
      type: "doc",
      content: [...references, paragraph(`Consumer tail ${suffix}`)],
    });
    await updatePageContent(api, deniedConsumer.id, {
      type: "doc",
      content: [references[0], paragraph(`Denied tail ${suffix}`)],
    });

    await fs.mkdir(downloadsDir, { recursive: true });
    let archiveBuffer: Buffer | undefined;
    for (const format of ["markdown", "html", "pdf", "docmost"] as const) {
      const response = await api.post("/api/pages/actions/export", {
        data: {
          pageId: consumer.id,
          format,
          includeChildren: format === "docmost",
          includeAttachments: true,
        },
      });
      expect(response.ok(), `${format} synced export status`).toBe(true);
      const buffer = await response.body();
      const exportZip = await JSZip.loadAsync(buffer);
      await fs.writeFile(
        path.join(
          downloadsDir,
          `${testInfo.project.name}-synced-${format}-export.zip`,
        ),
        buffer,
      );
      if (format === "markdown" || format === "html") {
        const extension = format === "markdown" ? ".md" : ".html";
        const entry = Object.keys(exportZip.files).find((name) =>
          name.endsWith(extension),
        );
        expect(entry).toBeTruthy();
        const rendered = await exportZip.file(entry!)!.async("string");
        for (const expected of [
          `Shared text ${suffix}`,
          `Shared list ${suffix}`,
          `Shared table ${suffix}`,
          `Shared diagram ${suffix}`,
        ]) {
          expect(rendered).toContain(expected);
        }
        expect(rendered).not.toContain("transclusionReference");
        expect(rendered).not.toContain("data-source-page-id");
        expect(rendered).not.toContain("data-transclusion-id");
        expect(rendered).not.toMatch(/javascript\s*:/i);
      } else if (format === "pdf") {
        const entry = Object.keys(exportZip.files).find((name) =>
          name.endsWith(".pdf"),
        );
        expect(entry).toBeTruthy();
        await fs.writeFile(
          path.join(downloadsDir, `${testInfo.project.name}-synced-export.pdf`),
          await exportZip.file(entry!)!.async("nodebuffer"),
        );
      } else {
        archiveBuffer = buffer;
        const metadata = JSON.parse(
          await exportZip.file("docmost-metadata.json")!.async("string"),
        );
        const data = JSON.parse(
          await exportZip.file("docmost-data.json")!.async("string"),
        );
        expect(metadata.schemaVersion).toBe(4);
        expect(data.schemaVersion).toBe(4);
        const archivedPageIds = new Set<string>(
          data.pages.map((archivedPage: { id: string }) => archivedPage.id),
        );
        expect(archivedPageIds).toContain(consumer.id);
        expect(archivedPageIds).toContain(source.id);
        const serializedArchive = JSON.stringify(data);
        expect(serializedArchive).not.toContain('"type":"pageEmbed"');
        expect(data.transclusionSnapshots).toEqual([]);
        for (const archivedPage of data.pages) {
          const stack = [archivedPage.content];
          while (stack.length > 0) {
            const node = stack.pop();
            if (!node || typeof node !== "object") continue;
            if (node.type === "transclusionReference") {
              expect(archivedPageIds).toContain(node.attrs.sourcePageId);
            }
            stack.push(...(node.content ?? []));
          }
        }
      }
    }

    expect(archiveBuffer).toBeTruthy();
    const preview = await parseResponse<any>(
      await api.post(
        `/api/pages/actions/import-zip/preview?spaceId=${state.spaceId}`,
        {
          multipart: {
            spaceId: state.spaceId,
            source: "docmost",
            file: {
              name: "synced-round-trip.zip",
              mimeType: "application/zip",
              buffer: archiveBuffer!,
            },
          },
        },
      ),
    );
    expect(preview.schemaVersion).toBe(4);
    expect(preview.counts.pages).toBeGreaterThanOrEqual(2);
    await apiPost(api, "/api/pages/actions/import-zip/confirm", {
      fileTaskId: preview.fileTaskId,
      applyDocumentFields: false,
      applyDictionary: false,
      applyHeadingNumbering: false,
      cleanupLegacyHeadingNumbers: true,
    });
    await expect
      .poll(
        async () => {
          const task = await apiPost<any>(api, "/api/file-tasks/info", {
            fileTaskId: preview.fileTaskId,
          });
          return task.status === "success" || task.status === "failed"
            ? task
            : null;
        },
        { timeout: 60_000 },
      )
      .not.toBeNull();
    const importTask = await apiPost<any>(api, "/api/file-tasks/info", {
      fileTaskId: preview.fileTaskId,
    });
    expect(importTask.status).toBe("success");
    expect(importTask.result?.report?.created?.pages).toBeGreaterThanOrEqual(2);
    expect(importTask.result?.report?.skipped?.pageReferences).toBe(0);

    member = await provisionAuditMember({
      api,
      browser,
      spaceId: state.spaceId,
      role: "writer",
    });
    await apiPost(api, "/api/users/update", {
      locale: "en-US",
      pageEditModeByPageId: {
        ...(originalPreferences.pageEditModeByPageId ?? {}),
        [consumer.id]: "edit",
        [workflowPage.id]: "edit",
      },
    });
    await member.post("/api/users/update", {
      locale: "en-US",
      pageEditModeByPageId: {
        [source.id]: "edit",
        [consumer.id]: "edit",
      },
    });

    let lookupRequests = 0;
    await page.route("**/api/pages/transclusion/lookup", async (route) => {
      lookupRequests += 1;
      if (lookupRequests === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "temporary audit failure" }),
        });
        return;
      }
      await route.continue();
    });
    await page.goto(pageUrl(state, consumer));
    await closeOverlayAside(page);
    await expect(mainEditor(page)).toContainText(`Shared text ${suffix}`);
    expect(lookupRequests).toBeGreaterThanOrEqual(2);
    await expect(mainEditor(page)).toContainText(`Shared list ${suffix}`);
    await expect(mainEditor(page)).toContainText(`Shared table ${suffix}`);
    await expect(page.getByAltText(`Shared media ${suffix}`)).toBeVisible();
    await expect(mainEditor(page)).toContainText(`Shared diagram ${suffix}`);
    await makeEditable(page);
    const firstReference = page
      .locator('[data-type="transclusionReference"]')
      .first();
    await firstReference.hover();
    await expect(
      firstReference.getByRole("button", { name: "Refresh" }),
    ).toBeVisible();
    await expect(
      firstReference.getByRole("link", { name: "Edit source" }),
    ).toBeVisible();
    await expect(
      firstReference.getByRole("button", { name: "More options" }),
    ).toBeVisible();

    const referencesButton = firstReference.getByRole("button", {
      name: /Synced to .* other page/,
    });
    await referencesButton.click();
    const referencesPopover = page
      .locator(".mantine-Popover-dropdown")
      .filter({ hasText: source.title });
    await expect(
      referencesPopover.getByRole("link").filter({ hasText: source.title }),
    ).toBeVisible();
    await expect(
      referencesPopover
        .getByRole("link")
        .filter({ hasText: deniedConsumer.title }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    memberSourcePage = await member.context.newPage();
    memberConsumerPage = await member.context.newPage();
    await Promise.all([
      memberSourcePage.goto(pageUrl(state, source)),
      memberConsumerPage.goto(pageUrl(state, consumer)),
    ]);
    await makeEditable(memberSourcePage);
    await expect(mainEditor(memberConsumerPage)).toContainText(
      `Shared text ${suffix}`,
    );
    const sourceText = mainEditor(memberSourcePage).getByText(
      `Shared text ${suffix}`,
      { exact: true },
    );
    await sourceText.click();
    await memberSourcePage.keyboard.press("End");
    await memberSourcePage.keyboard.type(" live-update");
    await expect(mainEditor(memberSourcePage)).toContainText(
      `Shared text ${suffix} live-update`,
    );
    await expect(mainEditor(page)).toContainText(
      `Shared text ${suffix} live-update`,
    );

    await apiPost(api, "/api/pages/actions/update", {
      pageId: source.id,
      title: `Renamed synced source ${suffix}`,
    });
    await expect
      .poll(async () => {
        const result = await apiPost<any>(
          api,
          "/api/pages/transclusion/references",
          { sourcePageId: source.id, transclusionId: ids.text },
        );
        return result.source?.title;
      })
      .toBe(`Renamed synced source ${suffix}`);

    await apiPost(api, `/api/pages/${source.id}/actions/access/close-user`, {
      userId: member.userId,
    });
    await expect(mainEditor(memberConsumerPage)).toContainText(
      "You don't have access to this synced block",
    );
    await apiPost(api, `/api/pages/${source.id}/actions/access/grant-user`, {
      userId: member.userId,
      role: "writer",
    });
    await expect(mainEditor(memberConsumerPage)).toContainText(
      `Shared text ${suffix} live-update`,
    );

    await apiPost(api, "/api/pages/actions/delete", {
      pageId: source.id,
      permanentlyDelete: false,
    });
    await expect(mainEditor(page)).toContainText(
      "You don't have access to this synced block",
    );
    await apiPost(api, "/api/pages/restore", { pageId: source.id });
    await expect(mainEditor(page)).toContainText(
      `Shared text ${suffix} live-update`,
    );

    const share = await apiPost<any>(api, "/api/shares/actions/create", {
      pageId: consumer.id,
      includeSubPages: true,
      searchIndexing: false,
    });
    shareId = share.id;
    publicContext = await browser.newContext({
      baseURL: baseUrl(),
      locale: "en-US",
    });
    const anonymousPage = await publicContext.newPage();
    await anonymousPage.goto(`/share/${share.id}/p/${consumer.slugId}`);
    await expect(publicDocument(anonymousPage)).toContainText(
      `Shared text ${suffix} live-update`,
    );
    await expect(publicDocument(anonymousPage)).toHaveAttribute(
      "contenteditable",
      "false",
    );
    await expect(
      anonymousPage.getByRole("button", { name: "Refresh" }),
    ).toHaveCount(0);

    await apiPost(api, "/api/pages/move", {
      pageId: source.id,
      parentPageId: moveTarget.id,
      position: generateJitteredKeyBetween(null, null),
    });
    await anonymousPage.reload();
    await expect(publicDocument(anonymousPage)).not.toContainText(
      `Shared text ${suffix} live-update`,
    );
    await expect(publicDocument(anonymousPage)).toContainText(
      "You don't have access to this synced block",
    );
    await apiPost(api, "/api/pages/move", {
      pageId: source.id,
      parentPageId: consumer.id,
      position: generateJitteredKeyBetween(null, null),
    });

    await apiPost(
      api,
      `/api/pages/${deniedConsumer.id}/actions/access/close-user`,
      { userId: member.userId },
    );
    await expect(
      member.post("/api/pages/transclusion/unsync-reference", {
        referencePageId: deniedConsumer.id,
        sourcePageId: source.id,
        transclusionId: ids.text,
      }),
    ).rejects.toThrow(/403/);
    const deniedReferences = await apiPost<any>(
      api,
      "/api/pages/transclusion/references",
      { sourcePageId: source.id, transclusionId: ids.text },
    );
    expect(
      deniedReferences.references.some(
        (reference: { id: string }) => reference.id === deniedConsumer.id,
      ),
    ).toBe(true);

    const sourceBeforeUnsync = await apiGet<PageInfo>(
      api,
      `/api/pages/info?pageId=${source.id}`,
    );
    await firstReference.hover();
    await firstReference.getByRole("button", { name: "More options" }).click();
    await page.getByRole("menuitem", { name: "Unsync" }).click();
    await expect(
      page.locator('[data-type="transclusionReference"]'),
    ).toHaveCount(Object.keys(ids).length - 1);
    const sourceAfterUnsync = await apiGet<PageInfo>(
      api,
      `/api/pages/info?pageId=${source.id}`,
    );
    expect(hashProseMirrorJson(sourceAfterUnsync.content)).toBe(
      hashProseMirrorJson(sourceBeforeUnsync.content),
    );

    await page.goto(pageUrl(state, source));
    await makeEditable(page);
    await page.evaluate(() => {
      (window as any).__syncedClipboard = null;
      if (typeof ClipboardItem === "undefined") {
        class AuditClipboardItem {
          readonly types: string[];
          constructor(private readonly entries: Record<string, Blob>) {
            this.types = Object.keys(entries);
          }
          async getType(type: string) {
            return this.entries[type];
          }
        }
        Object.defineProperty(window, "ClipboardItem", {
          configurable: true,
          value: AuditClipboardItem,
        });
      }
      const clipboard = {
        write: async (items: ClipboardItem[]) => {
          const item = items[0];
          const html = await (await item.getType("text/html")).text();
          const text = await (await item.getType("text/plain")).text();
          (window as any).__syncedClipboard = { html, text };
        },
        writeText: async (text: string) => {
          (window as any).__syncedClipboard = { html: "", text };
        },
      };
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: clipboard,
      });
    });
    const firstSource = page
      .locator('[data-type="transclusionSource"]')
      .first();
    await firstSource.hover();
    await firstSource
      .getByRole("button", { name: "Copy synced block" })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).__syncedClipboard as {
              html: string;
              text: string;
            } | null,
        ),
      )
      .not.toBeNull();
    const clipboardPayload = await page.evaluate(
      () => (window as any).__syncedClipboard as { html: string; text: string },
    );
    expect(clipboardPayload.html).toContain(
      `data-source-page-id="${source.id}"`,
    );
    expect(clipboardPayload.html).toContain(
      `data-transclusion-id="${ids.text}"`,
    );
    expect(clipboardPayload.text).toContain(`Shared text ${suffix}`);

    await page.goto(pageUrl(state, workflowPage));
    await makeEditable(page);
    const workflowEditor = mainEditor(page);
    const selectionText = workflowEditor.getByText(
      `Selection workflow ${suffix}`,
      {
        exact: true,
      },
    );
    await selectionText.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.getByRole("button", { name: "Create synced block" }).click();
    await expect(page.locator('[data-type="transclusionSource"]')).toHaveCount(
      1,
    );
    await selectionText.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await expect(
      page.getByRole("button", { name: "Create synced block" }),
    ).toHaveCount(0);

    await workflowEditor.locator("p").last().click();
    await page.keyboard.type("/");
    await page
      .locator("#slash-command")
      .getByText("Synced block", { exact: true })
      .click();
    await expect(page.locator('[data-type="transclusionSource"]')).toHaveCount(
      2,
    );

    await workflowEditor.locator("p").last().click();
    await page.keyboard.press("End");
    await page.evaluate((payload) => {
      const data = new DataTransfer();
      data.setData("text/html", payload.html);
      data.setData("text/plain", payload.text);
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "clipboardData", { value: data });
      document.activeElement?.dispatchEvent(event);
    }, clipboardPayload);
    await expect(
      page.locator('[data-type="transclusionReference"]'),
    ).toHaveCount(1);
    const malformed =
      '<div data-type="transclusionReference" data-source-page-id="not-a-uuid"><p>Malformed clipboard became ordinary text</p></div>';
    await workflowEditor.locator("p").last().click();
    await page.keyboard.press("End");
    await page.evaluate((html) => {
      const data = new DataTransfer();
      data.setData("text/html", html);
      data.setData("text/plain", "Malformed clipboard became ordinary text");
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "clipboardData", { value: data });
      document.activeElement?.dispatchEvent(event);
    }, malformed);
    await expect(
      page.locator('[data-type="transclusionReference"]'),
    ).toHaveCount(1);
    await expect(workflowEditor).toContainText(
      "Malformed clipboard became ordinary text",
    );
    await expect(page.locator('[data-type="pageEmbed"]')).toHaveCount(0);
    await captureStep(page, testInfo, "synced-block-workflow", {
      fullPage: true,
    });

    const nestedAttempt = await api.post("/api/pages/actions/update", {
      data: {
        pageId: source.id,
        format: "json",
        operation: "replace",
        content: {
          type: "doc",
          content: [
            {
              type: "transclusionSource",
              attrs: { id: randomUUID() },
              content: [
                {
                  type: "transclusionReference",
                  attrs: {
                    sourcePageId: source.id,
                    transclusionId: ids.text,
                  },
                },
              ],
            },
          ],
        },
      },
    });
    expect([400, 409]).toContain(nestedAttempt.status());
    await nestedAttempt.dispose();
    const finalWorkflow = await apiGet<PageInfo>(
      api,
      `/api/pages/info?pageId=${workflowPage.id}`,
    );
    expect(collectNodeTypes(finalWorkflow.content)).not.toContain("pageEmbed");
  } finally {
    if (shareId) {
      await apiPost(api, "/api/shares/actions/delete", { shareId }).catch(
        () => undefined,
      );
    }
    await publicContext?.close().catch(() => undefined);
    await memberSourcePage?.close().catch(() => undefined);
    await memberConsumerPage?.close().catch(() => undefined);
    await removeAuditMember(api, member);
    await apiPost(api, "/api/users/update", {
      locale: originalLocale,
      pageEditModeByPageId: originalPreferences.pageEditModeByPageId ?? {},
    }).catch(() => undefined);
    await api.dispose();
  }
});
