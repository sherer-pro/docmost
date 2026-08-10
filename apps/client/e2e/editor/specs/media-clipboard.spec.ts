import {
  apiGet,
  apiPost,
  createAdminApi,
  loadAuditState,
} from "../support/api";
import { pageUrl, seedComplexDocument } from "../support/complex-document";
import { captureStep, expect, mainEditor, test } from "../support/audit-test";

test("media nodes, fullscreen image, Mermaid sanitization and clipboard survive reload", async ({
  page,
  context,
}, testInfo) => {
  const api = await createAdminApi();
  const state = await loadAuditState();
  const current = await apiGet<any>(api, "/api/users/me");
  const original = current.user.settings?.preferences ?? {};
  const seeded = await seedComplexDocument(
    api,
    state,
    `${testInfo.project.name}-media`,
  );

  try {
    await apiPost(api, "/api/users/update", {
      pageEditModeByPageId: {
        ...(original.pageEditModeByPageId ?? {}),
        [seeded.page.id]: "read",
      },
    });
    await page.goto(pageUrl(state, seeded.page));
    await expect(mainEditor(page)).toContainText("Editor regression audit");
    await expect(page.locator(".editor-container")).toBeVisible({
      timeout: 20_000,
    });

    const image = page.getByAltText("Editor audit image alt text");
    await expect(image).toBeVisible();
    await image.click();
    const imagePreview = page.getByRole("dialog").filter({
      has: page.getByAltText("Editor audit image alt text"),
    });
    await expect(imagePreview).toBeVisible();
    await expect(
      imagePreview.getByAltText("Editor audit image alt text"),
    ).toBeVisible();
    const closePreview = imagePreview.getByRole("button").first();
    await expect(closePreview).toHaveAttribute("aria-label", /\S+/);
    await closePreview.focus();
    for (let index = 0; index < 4; index += 1) {
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(() =>
          Boolean(document.activeElement?.closest('[role="dialog"]')),
        ),
      ).toBe(true);
    }
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    const zoomedDialog = await imagePreview.boundingBox();
    expect(zoomedDialog).not.toBeNull();
    expect(zoomedDialog!.x).toBeGreaterThanOrEqual(-1);
    expect(zoomedDialog!.width).toBeLessThanOrEqual(
      (page.viewportSize()?.width ?? zoomedDialog!.width) + 1,
    );
    await captureStep(page, testInfo, "04a-image-preview-200-percent");
    await page.evaluate(() => {
      document.documentElement.style.zoom = "";
    });
    await page.keyboard.press("Escape");

    const audio = page.locator("audio[controls]").first();
    await expect(audio).toBeVisible();
    expect(
      await audio.evaluate((element: HTMLAudioElement) => element.preload),
    ).toBe("metadata");
    await audio.click();
    const playback = await audio.evaluate(async (element: HTMLAudioElement) => {
      try {
        await element.play();
        const result = { ok: true, paused: element.paused };
        element.pause();
        return result;
      } catch (error) {
        return { ok: false, paused: element.paused, error: String(error) };
      }
    });
    if (playback.ok) {
      expect(playback.paused, "audio playback state").toBe(false);
    } else {
      testInfo.annotations.push({
        type: "capability",
        description: `Audio playback unavailable in this browser build: ${playback.error}`,
      });
    }
    await expect(
      page
        .locator(
          "video[aria-label='Editor audit video alt text'], video[controls]",
        )
        .first(),
    ).toBeVisible();
    await expect(
      page.locator("iframe[src*='audit-document.pdf']"),
    ).toBeVisible();
    await expect(page.getByAltText("Draw.io diagram alt text")).toBeVisible();
    await expect(
      page.getByAltText("Excalidraw diagram alt text"),
    ).toBeVisible();

    await expect(page.locator(".codeBlock svg").first()).toBeVisible();
    await expect(
      page
        .getByText(
          /Invalid Mermaid diagram|Mermaid diagram error:|Недопустимая диаграмма Mermaid|Ошибка диаграммы Mermaid:/,
        )
        .first(),
    ).toBeVisible();
    expect(await page.locator(".codeBlock script").count()).toBe(0);
    expect(
      await page.locator(".codeBlock [onerror], .codeBlock [onclick]").count(),
    ).toBe(0);
    expect(
      await page.locator(".codeBlock a[href^='javascript:']").count(),
    ).toBe(0);
    expect(
      await page.evaluate(() => (window as any).__editorAuditXss ?? null),
    ).toBeNull();

    const pageBreak = page
      .locator(".page-break, [data-type='pageBreak']")
      .first();
    await expect(pageBreak).toBeVisible();
    const canUseClipboard = await page.evaluate(() =>
      Boolean(navigator.clipboard),
    );
    if (canUseClipboard) {
      await context
        .grantPermissions(["clipboard-read", "clipboard-write"])
        .catch(() => undefined);
      testInfo.annotations.push({
        type: "capability",
        description:
          "Clipboard API exposed; mutation is covered in the editable desktop scenario",
      });
    } else {
      testInfo.annotations.push({
        type: "capability",
        description: "Clipboard API unavailable in this browser build",
      });
    }

    await page.reload();
    await expect(mainEditor(page)).toContainText("Editor regression audit");
    await expect(
      page.getByAltText("Editor audit image alt text"),
    ).toBeVisible();
    await captureStep(page, testInfo, "04-media-mermaid-clipboard", {
      fullPage: true,
    });
  } finally {
    await apiPost(api, "/api/users/update", {
      pageEditModeByPageId: original.pageEditModeByPageId ?? {},
    }).catch(() => undefined);
    await api.dispose();
  }
});
