import {
  apiGet,
  apiPost,
  attachmentUrl,
  createAdminApi,
  createPage,
  loadAuditState,
  tinySvg,
  updatePageContent,
  uploadFixture,
} from "../support/api";
import { pageUrl } from "../support/complex-document";
import { captureStep, expect, mainEditor, test } from "../support/audit-test";

test("copied Excalidraw diagrams detach on save and keep focus inside an accessible modal", async ({
  page,
}, testInfo) => {
  const api = await createAdminApi();
  const state = await loadAuditState();
  const current = await apiGet<any>(api, "/api/users/me");
  const original = current.user.settings?.preferences ?? {};
  const auditPage = await createPage(
    api,
    state.spaceId,
    `${testInfo.project.name} Excalidraw copy`,
  );
  const attachment = await uploadFixture(
    api,
    auditPage.id,
    "shared-excalidraw.svg",
    "image/svg+xml",
    tinySvg(),
  );
  const excalidrawNode = {
    type: "excalidraw",
    attrs: {
      src: attachmentUrl(attachment),
      title: "Shared Excalidraw copy target",
      attachmentId: attachment.id,
      width: "100%",
      widthMode: "normal",
      align: "center",
    },
  };
  await updatePageContent(api, auditPage.id, {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Excalidraw anchor" }],
      },
      excalidrawNode,
      { ...excalidrawNode, attrs: { ...excalidrawNode.attrs } },
    ],
  });

  try {
    await apiPost(api, "/api/users/update", {
      pageEditModeByPageId: {
        ...(original.pageEditModeByPageId ?? {}),
        [auditPage.id]: "edit",
      },
    });
    await page.goto(pageUrl(state, auditPage));
    await expect(mainEditor(page)).toHaveAttribute("contenteditable", "true", {
      timeout: 20_000,
    });
    const diagrams = page.getByAltText("Shared Excalidraw copy target");
    await expect(diagrams).toHaveCount(2);
    await diagrams.nth(1).dblclick();

    const dialog = page.getByRole("dialog").filter({
      has: page.locator(".excalidraw"),
    });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog).toHaveAccessibleName(/\S+/);
    await expect(dialog.locator(".excalidraw")).toBeVisible({
      timeout: 20_000,
    });
    const buttons = dialog.getByRole("button");
    await expect(buttons.first()).toBeVisible();
    await buttons.first().focus();
    for (let index = 0; index < 6; index += 1) {
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(() =>
          Boolean(document.activeElement?.closest('[role="dialog"]')),
        ),
      ).toBe(true);
    }
    await captureStep(page, testInfo, "07-excalidraw-accessible-modal");
    await buttons.first().click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    let attachmentIds: string[] = [];
    await expect
      .poll(
        async () => {
          const savedPage = await apiGet<any>(
            api,
            `/api/pages/info?pageId=${encodeURIComponent(auditPage.id)}`,
          );
          attachmentIds = [];
          const visit = (node: any) => {
            if (node?.type === "excalidraw" && node.attrs?.attachmentId) {
              attachmentIds.push(node.attrs.attachmentId);
            }
            for (const child of node?.content ?? []) visit(child);
          };
          visit(savedPage.content);
          return new Set(attachmentIds).size;
        },
        { timeout: 20_000 },
      )
      .toBe(2);
  } finally {
    await apiPost(api, "/api/users/update", {
      fixedToolbar: original.fixedToolbar ?? false,
      pageEditModeByPageId: original.pageEditModeByPageId ?? {},
    }).catch(() => undefined);
    await api.dispose();
  }
});
