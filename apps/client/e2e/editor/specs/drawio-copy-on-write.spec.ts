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
import { expect, mainEditor, test } from "../support/audit-test";

test("saving a copied Draw.io diagram creates a separate attachment", async ({
  page,
}, testInfo) => {
  const api = await createAdminApi();
  const state = await loadAuditState();
  const current = await apiGet<any>(api, "/api/users/me");
  const original = current.user.settings?.preferences ?? {};
  const auditPage = await createPage(
    api,
    state.spaceId,
    `${testInfo.project.name} Draw.io copy-on-write`,
    {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Draw.io copy-on-write probe" }],
        },
      ],
    },
  );
  const attachment = await uploadFixture(
    api,
    auditPage.id,
    "drawio-copy-on-write.svg",
    "image/svg+xml",
    tinySvg(),
  );
  const attrs = {
    src: attachmentUrl(attachment),
    title: "Draw.io copy-on-write target",
    attachmentId: attachment.id,
    width: "100%",
    widthMode: "normal",
    align: "center",
  };
  await updatePageContent(api, auditPage.id, {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Draw.io copy-on-write probe" }],
      },
      { type: "drawio", attrs },
      { type: "drawio", attrs },
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
    await expect(mainEditor(page)).toHaveAttribute("contenteditable", "true");

    const diagrams = page.getByAltText("Draw.io copy-on-write target");
    await expect(diagrams).toHaveCount(2);
    await diagrams.nth(1).evaluate((element) => {
      element.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, detail: 2 }),
      );
    });
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

    let attachmentIds: string[] = [];
    await expect
      .poll(
        async () => {
          const savedPage = await apiGet<any>(
            api,
            `/api/pages/info?pageId=${encodeURIComponent(auditPage.id)}`,
          );
          attachmentIds = (savedPage.content?.content ?? [])
            .filter((node: any) => node.type === "drawio")
            .map((node: any) => node.attrs?.attachmentId)
            .filter(Boolean);
          return new Set(attachmentIds).size;
        },
        { timeout: 15_000 },
      )
      .toBe(2);

    expect(attachmentIds).toHaveLength(2);
    expect(attachmentIds[0]).toBe(attachment.id);
    expect(attachmentIds[1]).not.toBe(attachment.id);
  } finally {
    await apiPost(api, "/api/users/update", {
      pageEditModeByPageId: original.pageEditModeByPageId ?? {},
    }).catch(() => undefined);
    await api.dispose();
  }
});
