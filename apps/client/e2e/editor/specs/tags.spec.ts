import JSZip from "jszip";
import { DOCMOST_ARCHIVE_SCHEMA_VERSION } from "../../../../../packages/api-contract/src/docmost-archive";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  createAdminApi,
  createPage,
  loadAuditState,
  parseResponse,
  updatePageContent,
} from "../support/api";
import { pageUrl } from "../support/complex-document";
import { expect, mainEditor, test } from "../support/audit-test";

const tagValues = ["tbd", "todo", "done", "core", "future", "pilot"];
const tagLabels = ["TBD", "TODO", "DONE", "Core", "Future", "Pilot"];
const tagMenuLabels = tagLabels.map((label) => `Tag ${label}`);

const tagDocument = (prefix: string) => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: `${prefix} ` },
        ...tagValues.flatMap((value, index) => [
          { type: "tag", attrs: { value } },
          ...(index < tagValues.length - 1
            ? [{ type: "text", text: " " }]
            : []),
        ]),
      ],
    },
    { type: "paragraph" },
  ],
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

async function focusEditorEnd(page: import("@playwright/test").Page) {
  const paragraph = mainEditor(page).locator("p").last();
  const box = await paragraph.boundingBox();
  if (!box) throw new Error("The last editor paragraph is not visible");
  await paragraph.click({
    position: {
      x: Math.max(2, box.width - 2),
      y: Math.max(2, Math.min(box.height - 2, box.height / 2)),
    },
  });
  await page.keyboard.press("End");
  return paragraph;
}

async function openTagSlashMenu(page: import("@playwright/test").Page) {
  const paragraph = await focusEditorEnd(page);
  while ((await paragraph.textContent())?.endsWith("/")) {
    await page.keyboard.press("Backspace");
  }
  await page.keyboard.type("/");
  const slashMenu = page.locator("#slash-command");
  await expect(slashMenu).toBeVisible();
  await slashMenu.getByText("Tag", { exact: true }).click();
  return slashMenu;
}

async function closeTagSlashMenu(page: import("@playwright/test").Page) {
  await page.keyboard.press("Escape");
  const paragraph = await focusEditorEnd(page);
  while ((await paragraph.textContent())?.endsWith("/")) {
    await page.keyboard.press("Backspace");
  }
}

async function captureClipboard(
  page: import("@playwright/test").Page,
  eventName: "copy" | "cut",
) {
  await page.evaluate((name) => {
    (window as any).__tagClipboard = null;
    document.addEventListener(
      name,
      (event) => {
        const clipboardEvent = event as ClipboardEvent;
        (window as any).__tagClipboard = {
          html: clipboardEvent.clipboardData?.getData("text/html") ?? "",
          text: clipboardEvent.clipboardData?.getData("text/plain") ?? "",
        };
      },
      { once: true },
    );
  }, eventName);
  await page.keyboard.press(eventName === "copy" ? "Control+c" : "Control+x");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__tagClipboard as {
            html: string;
            text: string;
          } | null,
      ),
    )
    .not.toBeNull();
  return page.evaluate(
    () => (window as any).__tagClipboard as { html: string; text: string },
  );
}

async function dispatchPaste(
  page: import("@playwright/test").Page,
  clipboard: { html?: string; text: string },
) {
  await mainEditor(page).evaluate((element, value) => {
    const data = new DataTransfer();
    if (value.html) data.setData("text/html", value.html);
    data.setData("text/plain", value.text);
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "clipboardData", { value: data });
    element.dispatchEvent(event);
  }, clipboard);
}

test("keeps inline tags space-scoped across editors, clipboard and archive import", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const api = await createAdminApi();
  const auditState = await loadAuditState();
  const currentUser = await apiGet<any>(api, "/api/users/me");
  const originalLocale = currentUser.user.locale;
  const originalPreferences = currentUser.user.settings?.preferences ?? {};
  const auditSpaceBefore = await apiGet<any>(
    api,
    `/api/spaces/${auditState.spaceId}`,
  );
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  let spaceId: string | undefined;

  try {
    await apiPost(api, "/api/users/update", { locale: "en-US" });
    const space = await apiPost<any>(api, "/api/spaces", {
      name: `Tag audit ${suffix}`,
      slug: `tagaudit${Date.now()}`,
      description: "Temporary inline-tag audit space.",
    });
    spaceId = space.id;
    await apiPatch(api, `/api/spaces/${space.id}`, {
      spaceId: space.id,
      tagSettings: { disabled: ["future"] },
    });

    const pageRecord = await createPage(
      api,
      space.id,
      `Inline tags ${suffix}`,
      tagDocument("Regular page tags"),
    );
    const database = await apiPost<any>(api, "/api/databases", {
      spaceId: space.id,
      name: `Tag database ${suffix}`,
    });
    expect(database.pageId).toBeTruthy();
    const databasePage = await apiGet<any>(
      api,
      `/api/pages/info?pageId=${database.pageId}`,
    );
    expect(databasePage.slugId).toBeTruthy();
    await updatePageContent(
      api,
      databasePage.id,
      tagDocument("Database description tags"),
    );

    await apiPost(api, "/api/users/update", {
      pageEditModeByPageId: {
        ...(originalPreferences.pageEditModeByPageId ?? {}),
        [pageRecord.id]: "edit",
        [databasePage.id]: "edit",
      },
    });

    const auditSpaceAfter = await apiGet<any>(
      api,
      `/api/spaces/${auditState.spaceId}`,
    );
    expect(auditSpaceAfter.settings?.tags).toEqual(
      auditSpaceBefore.settings?.tags,
    );

    const isolatedState = {
      ...auditState,
      spaceId: space.id,
      spaceSlug: space.slug,
      spaceName: space.name,
    };
    await page.goto(pageUrl(isolatedState, pageRecord));
    await makeEditable(page);
    const editor = mainEditor(page);
    for (const [index, label] of tagLabels.entries()) {
      await expect(
        editor.locator(`[data-tag-value="${tagValues[index]}"]`).first(),
      ).toContainText(label);
    }

    let slashMenu = await openTagSlashMenu(page);
    for (const label of tagMenuLabels.filter(
      (label) => label !== "Tag Future",
    )) {
      await expect(slashMenu.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(
      slashMenu.getByText("Tag Future", { exact: true }),
    ).toHaveCount(0);
    await closeTagSlashMenu(page);

    await page.evaluate(() => {
      (window as any).__tagSettingsMarker = "same-document";
    });
    await page.getByRole("button", { name: "Space menu" }).click();
    await page.getByRole("menuitem", { name: "Space settings" }).click();
    const modal = page.getByRole("dialog", { name: /Tag audit/ });
    await expect(modal).toBeVisible();
    const labelsY = (await modal
      .getByText("Labels", { exact: true })
      .boundingBox())!.y;
    const tagsY = (await modal
      .getByText("Tags", { exact: true })
      .boundingBox())!.y;
    const dictionaryY = (await modal
      .getByText("Dictionary", { exact: true })
      .boundingBox())!.y;
    expect(labelsY).toBeLessThan(tagsY);
    expect(tagsY).toBeLessThan(dictionaryY);

    const futureCheckbox = modal.getByRole("checkbox", { name: /Future/ });
    await expect(futureCheckbox).not.toBeChecked();
    const enableFutureResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith(`/api/spaces/${space.id}`),
      { timeout: 15_000 },
    );
    await futureCheckbox.evaluate((element: HTMLInputElement) =>
      element.click(),
    );
    expect((await enableFutureResponse).ok()).toBe(true);
    await expect(futureCheckbox).toBeChecked();
    await modal.getByRole("button", { name: "Close" }).click();
    expect(await page.evaluate(() => (window as any).__tagSettingsMarker)).toBe(
      "same-document",
    );

    slashMenu = await openTagSlashMenu(page);
    for (const label of tagMenuLabels) {
      await expect(slashMenu.getByText(label, { exact: true })).toBeVisible();
    }
    await slashMenu.getByText("Tag Core", { exact: true }).click();
    await expect(editor.locator('[data-tag-value="core"]')).toHaveCount(2);

    await page.getByRole("button", { name: "Space menu" }).click();
    await page.getByRole("menuitem", { name: "Space settings" }).click();
    const pilotCheckbox = page
      .getByRole("dialog", { name: /Tag audit/ })
      .getByRole("checkbox", { name: /Pilot/ });
    const disablePilotResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith(`/api/spaces/${space.id}`),
      { timeout: 15_000 },
    );
    await pilotCheckbox.evaluate((element: HTMLInputElement) =>
      element.click(),
    );
    expect((await disablePilotResponse).ok()).toBe(true);
    await page
      .getByRole("dialog", { name: /Tag audit/ })
      .getByRole("button", { name: "Close" })
      .click();

    slashMenu = await openTagSlashMenu(page);
    await expect(slashMenu.getByText("Tag Pilot", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      slashMenu.getByText("Tag Future", { exact: true }),
    ).toBeVisible();
    await closeTagSlashMenu(page);

    const firstCore = editor.locator('[data-tag-value="core"]').first();
    await firstCore.click();
    const copiedCore = await captureClipboard(page, "copy");
    expect(copiedCore.html).toContain('data-type="tag"');
    expect(copiedCore.html).toContain('data-tag-value="core"');
    expect(copiedCore.text).toBe("::tag[Core]");
    const supportsNativeClipboard =
      testInfo.project.name.startsWith("chromium");
    if (supportsNativeClipboard) {
      await page
        .context()
        .grantPermissions(["clipboard-read", "clipboard-write"], {
          origin: new URL(page.url()).origin,
        });
      await page.evaluate(async (clipboard) => {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([clipboard.html], { type: "text/html" }),
            "text/plain": new Blob([clipboard.text], { type: "text/plain" }),
          }),
        ]);
      }, copiedCore);
    }
    await page.keyboard.press("Escape");

    await focusEditorEnd(page);
    await page.keyboard.press("Enter");
    await page.evaluate(() => {
      (window as any).__tagPasteClipboard = null;
      document.addEventListener(
        "paste",
        (event) => {
          const clipboardEvent = event as ClipboardEvent;
          (window as any).__tagPasteClipboard = {
            html: clipboardEvent.clipboardData?.getData("text/html") ?? "",
            text: clipboardEvent.clipboardData?.getData("text/plain") ?? "",
          };
        },
        { once: true },
      );
    });
    if (supportsNativeClipboard) {
      await page.keyboard.press("Control+v");
    } else {
      await dispatchPaste(page, copiedCore);
    }
    const pastedCore = await page.evaluate(
      () =>
        (window as any).__tagPasteClipboard as {
          html: string;
          text: string;
        },
    );
    expect(pastedCore.html).toContain('data-type="tag"');
    expect(pastedCore.html).toContain('data-tag-value="core"');
    expect(pastedCore.text).toBe("::tag[Core]");
    await expect(editor.locator('[data-tag-value="core"]')).toHaveCount(3);

    await focusEditorEnd(page);
    await page.keyboard.press("Enter");
    const plainClipboard = {
      text: "Plain ::tag[Pilot] then ::tag[Future] clipboard",
    };
    if (supportsNativeClipboard) {
      await page.evaluate(
        (clipboard) => navigator.clipboard.writeText(clipboard.text),
        plainClipboard,
      );
      await page.keyboard.press("Control+v");
    } else {
      await dispatchPaste(page, plainClipboard);
    }
    await expect(editor).toContainText("Plain Pilot then Future clipboard");
    await expect(editor.locator('[data-tag-value="pilot"]')).toHaveCount(2);
    await expect(editor.locator('[data-tag-value="future"]')).toHaveCount(2);

    await editor.locator('[data-tag-value="core"]').last().click();
    const coreCountBeforeCut = await editor
      .locator('[data-tag-value="core"]')
      .count();
    const cutCore = await captureClipboard(page, "cut");
    expect(cutCore.text).toBe("::tag[Core]");
    await expect(editor.locator('[data-tag-value="core"]')).toHaveCount(
      coreCountBeforeCut - 1,
    );

    await page.goto(`/s/${space.slug}/db/${databasePage.slugId}`);
    const databaseEditor = mainEditor(page);
    await expect(databaseEditor).toContainText("Database description tags");
    for (const [index, label] of tagLabels.entries()) {
      await expect(
        databaseEditor
          .locator(`[data-tag-value="${tagValues[index]}"]`)
          .first(),
      ).toContainText(label);
    }

    const exportResponse = await api.post("/api/pages/actions/export", {
      data: {
        pageId: pageRecord.id,
        format: "docmost",
        includeChildren: false,
        includeAttachments: false,
      },
    });
    expect(exportResponse.ok()).toBe(true);
    const archiveBuffer = await exportResponse.body();
    const archive = await JSZip.loadAsync(archiveBuffer);
    const archiveData = JSON.parse(
      await archive.file("docmost-data.json")!.async("string"),
    );
    expect(archiveData.schemaVersion).toBe(DOCMOST_ARCHIVE_SCHEMA_VERSION);
    expect(archiveData.sourceSpace.settings.tags).toEqual({
      disabled: ["pilot"],
    });
    expect(JSON.stringify(archiveData.pages)).toContain('"type":"tag"');

    await apiPatch(api, `/api/spaces/${space.id}`, {
      spaceId: space.id,
      tagSettings: { disabled: ["core"] },
    });
    const preview = await parseResponse<any>(
      await api.post(
        `/api/pages/actions/import-zip/preview?spaceId=${space.id}`,
        {
          multipart: {
            spaceId: space.id,
            source: "docmost",
            file: {
              name: "tag-round-trip.zip",
              mimeType: "application/zip",
              buffer: archiveBuffer,
            },
          },
        },
      ),
    );
    expect(preview.schemaVersion).toBe(DOCMOST_ARCHIVE_SCHEMA_VERSION);
    expect(preview.availableSettings.tags).toBe(true);
    await apiPost(api, "/api/pages/actions/import-zip/confirm", {
      fileTaskId: preview.fileTaskId,
      applyDocumentFields: false,
      applyDictionary: false,
      applyHeadingNumbering: false,
      applyTags: true,
      cleanupLegacyHeadingNumbers: true,
    });
    await expect
      .poll(
        async () => {
          const task = await apiPost<any>(api, "/api/file-tasks/info", {
            fileTaskId: preview.fileTaskId,
          });
          return task.status;
        },
        { timeout: 60_000 },
      )
      .toBe("success");
    const importedSpace = await apiGet<any>(api, `/api/spaces/${space.id}`);
    expect(importedSpace.settings.tags).toEqual({ disabled: ["pilot"] });
  } finally {
    await apiPost(api, "/api/users/update", {
      locale: originalLocale,
      pageEditModeByPageId: originalPreferences.pageEditModeByPageId ?? {},
    }).catch(() => undefined);
    if (spaceId) {
      await apiDelete(api, `/api/spaces/${spaceId}`).catch(() => undefined);
    }
    await api.dispose();
  }
});
