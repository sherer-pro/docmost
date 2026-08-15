import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import {
  apiGet,
  apiPost,
  createAdminApi,
  loadAuditState,
} from "../support/api";
import { pageUrl, seedComplexDocument } from "../support/complex-document";
import {
  captureStep,
  expect,
  mainEditor,
  publicDocument,
  runAxe,
  test,
} from "../support/audit-test";
import { downloadsDir } from "../support/paths";
import { baseUrl } from "../support/auth";

function collectNodeTypes(
  node: unknown,
  types = new Set<string>(),
): Set<string> {
  if (!node || typeof node !== "object") return types;
  const record = node as { type?: unknown; content?: unknown[] };
  if (typeof record.type === "string") types.add(record.type);
  for (const child of record.content ?? []) collectNodeTypes(child, types);
  return types;
}

function collectMarkTypes(
  node: unknown,
  types = new Set<string>(),
): Set<string> {
  if (!node || typeof node !== "object") return types;
  const record = node as {
    marks?: Array<{ type?: unknown }>;
    content?: unknown[];
  };
  for (const mark of record.marks ?? []) {
    if (typeof mark.type === "string") types.add(mark.type);
  }
  for (const child of record.content ?? []) collectMarkTypes(child, types);
  return types;
}

test("renders the all-node document, marks, widths, numbering, readonly and export", async ({
  page,
  browser,
}, testInfo) => {
  const api = await createAdminApi();
  const state = await loadAuditState();
  const current = await apiGet<any>(api, "/api/users/me");
  const originalPreferences = current.user.settings?.preferences ?? {};
  const seeded = await seedComplexDocument(api, state, testInfo.project.name);
  let shareId: string | undefined;
  let publicContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;

  try {
    const auditOrigin = new URL(baseUrl()).origin;
    await page.route("**/*", async (route) => {
      if (new URL(route.request().url()).origin !== auditOrigin) {
        await route.abort();
        return;
      }
      await route.continue();
    });
    await apiPost(api, "/api/users/update", {
      headingNumberingByPageId: {
        ...(originalPreferences.headingNumberingByPageId ?? {}),
        [seeded.page.id]: true,
      },
      pageEditModeByPageId: {
        ...(originalPreferences.pageEditModeByPageId ?? {}),
        [seeded.page.id]: "read",
      },
    });
    const persistedPreferences = (await apiGet<any>(api, "/api/users/me")).user
      .settings?.preferences;
    expect(
      persistedPreferences?.headingNumberingByPageId?.[seeded.page.id],
    ).toBe(true);
    expect(persistedPreferences?.pageEditModeByPageId?.[seeded.page.id]).toBe(
      "read",
    );

    await page.goto(pageUrl(state, seeded.page));
    const editor = mainEditor(page);
    await expect(editor).toContainText("Editor regression audit");
    await expect(page.locator(".heading-number")).toHaveCount(4);
    await expect(page.locator(".heading-number").nth(0)).toHaveText("1.");
    await expect(page.locator(".heading-number").nth(1)).toHaveText("1.1.");
    await expect(page.locator(".heading-number").nth(2)).toHaveText("1.1.1.");
    await expect(page.locator(".heading-number").nth(3)).toHaveText("1.2.");

    const serializedPage = await apiGet<any>(
      api,
      `/api/pages/info?pageId=${encodeURIComponent(seeded.page.id)}`,
    );
    const nodeTypes = collectNodeTypes(serializedPage.content);
    const markTypes = collectMarkTypes(serializedPage.content);
    for (const type of seeded.expectedNodeTypes) {
      expect(nodeTypes, `serialized node ${type}`).toContain(type);
    }
    for (const type of seeded.expectedMarkTypes) {
      expect(markTypes, `serialized mark ${type}`).toContain(type);
    }

    await expect(page.locator("strong")).toContainText("bold");
    await expect(page.locator("em")).toContainText("italic");
    await expect(page.locator("u")).toContainText("underline");
    await expect(page.locator("s")).toContainText("strike");
    await expect(page.locator("sup")).toContainText("superscript");
    await expect(page.locator("sub")).toContainText("subscript");
    await expect(page.locator("mark")).toContainText("highlight");
    await expect(page.locator("span.comment-mark")).toContainText("comment");
    await expect(
      page.locator("[data-block-width-mode='full']").first(),
    ).toBeVisible();
    await expect(page.locator("table")).toBeVisible();
    await expect(
      page.locator(".page-break, [data-type='pageBreak']"),
    ).toHaveCount(1);
    await expect(
      page.getByAltText("Editor audit image alt text"),
    ).toBeVisible();
    await expect(page.locator("audio[controls]")).toBeVisible();
    await expect(page.locator("video[controls]")).toBeVisible();
    await expect(
      page.locator("iframe[src*='audit-document.pdf']"),
    ).toBeVisible();
    await expect(editor.getByText(seeded.childPage.title)).toBeVisible();
    const transclusionReference = editor
      .locator('[data-type="transclusionReference"]')
      .first();
    await transclusionReference.scrollIntoViewIfNeeded();
    await expect(
      transclusionReference.getByText("Shared source content"),
    ).toBeVisible();
    await expect(
      editor.getByRole("link", { name: "External safe preview" }),
    ).toHaveAttribute("href", "https://example.com/");
    await expect(
      editor.locator("a").filter({ hasText: seeded.sourcePage.title }).first(),
    ).toHaveAttribute("href", new RegExp(seeded.sourcePage.slugId));

    await captureStep(page, testInfo, "01-all-node-document", {
      fullPage: true,
    });
    await runAxe(page, testInfo);

    await editor
      .getByRole("link", { name: seeded.childPage.title, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(seeded.childPage.slugId));
    await expect(mainEditor(page)).toContainText(
      "Child page used by the subpage navigation audit.",
    );
    await captureStep(page, testInfo, "01b-subpage-navigation");
    await page.goBack();
    await expect(editor).toContainText("Editor regression audit");

    await expect(editor).toHaveAttribute("contenteditable", "false");
    await expect(page.getByRole("toolbar")).toHaveCount(0);
    await captureStep(page, testInfo, "02-readonly-document", {
      fullPage: true,
    });

    const share = await apiPost<any>(api, "/api/shares/actions/create", {
      pageId: seeded.page.id,
      includeSubPages: true,
      searchIndexing: false,
    });
    shareId = share.id;
    publicContext = await browser.newContext({
      baseURL: baseUrl(),
      locale: "en-US",
      serviceWorkers: "block",
    });
    await publicContext.route("**/*", async (route) => {
      if (new URL(route.request().url()).origin !== auditOrigin) {
        await route.abort();
        return;
      }
      await route.continue();
    });
    const publicPage = await publicContext.newPage();
    const publicResponse = await publicPage.goto(
      `/share/${share.id}/p/${seeded.page.slugId}`,
      { waitUntil: "domcontentloaded" },
    );
    expect(publicResponse?.ok(), "public share shell status").toBe(true);
    const publicEditor = publicDocument(publicPage);
    await expect(publicEditor).toContainText("Editor regression audit");
    await expect(publicEditor).toHaveAttribute("contenteditable", "false");
    await expect(
      publicPage.getByAltText("Editor audit image alt text"),
    ).toBeVisible();
    await expect(publicPage.getByRole("toolbar")).toHaveCount(0);
    await runAxe(publicPage, testInfo, "body", "public-share");
    await captureStep(publicPage, testInfo, "02b-public-all-node-share", {
      fullPage: true,
    });
    await publicContext.close();
    publicContext = undefined;

    await fs.mkdir(downloadsDir, { recursive: true });
    for (const format of ["markdown", "html", "pdf"] as const) {
      const response = await api.post("/api/pages/actions/export", {
        data: {
          pageId: seeded.page.id,
          format,
          includeChildren: false,
          includeAttachments: true,
        },
      });
      expect(response.ok(), `${format} export status`).toBeTruthy();
      const zipFile = path.join(
        downloadsDir,
        `${testInfo.project.name}-${format}-export.zip`,
      );
      const body = await response.body();
      await fs.writeFile(zipFile, body);
      const zip = await JSZip.loadAsync(body);
      const names = Object.keys(zip.files);
      expect(names.length).toBeGreaterThan(0);
      if (format === "html") {
        const htmlName = names.find((name) => name.endsWith(".html"));
        expect(htmlName).toBeTruthy();
        const html = await zip.file(htmlName!)!.async("string");
        expect(html).toContain("page-break");
        const executablePayloads = await page.evaluate((documentHtml) => {
          const parsed = new DOMParser().parseFromString(
            documentHtml,
            "text/html",
          );
          return Array.from(parsed.querySelectorAll("*")).flatMap((element) =>
            Array.from(element.attributes)
              .filter(
                ({ name, value }) =>
                  name.toLowerCase().startsWith("on") ||
                  (["href", "src", "xlink:href"].includes(name.toLowerCase()) &&
                    /^\s*javascript:/i.test(value)),
              )
              .map(({ name, value }) => `${element.tagName}.${name}=${value}`),
          );
        }, html);
        expect(executablePayloads).toEqual([]);
      }
      if (format === "pdf") {
        const pdfName = names.find(
          (name) =>
            name.endsWith(".pdf") &&
            !name.replaceAll("\\", "/").startsWith("files/"),
        );
        expect(pdfName).toBeTruthy();
        await fs.writeFile(
          path.join(downloadsDir, `${testInfo.project.name}-editor-export.pdf`),
          await zip.file(pdfName!)!.async("nodebuffer"),
        );
      }
    }
  } finally {
    await publicContext?.close().catch(() => undefined);
    if (shareId) {
      await apiPost(api, "/api/shares/actions/delete", { shareId }).catch(
        () => undefined,
      );
    }
    await apiPost(api, "/api/users/update", {
      fixedToolbar: originalPreferences.fixedToolbar ?? false,
      headingNumberingByPageId:
        originalPreferences.headingNumberingByPageId ?? {},
      pageEditModeByPageId: originalPreferences.pageEditModeByPageId ?? {},
    }).catch(() => undefined);
    await api.dispose();
  }
});
