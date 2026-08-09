import {
  apiPost,
  createAdminApi,
  createPage,
  loadAuditState,
} from "../support/api";
import { baseUrl } from "../support/auth";
import { pageUrl } from "../support/complex-document";
import {
  captureStep,
  expect,
  mainEditor,
  publicDocument,
  recordDefect,
  test,
} from "../support/audit-test";
import {
  provisionAuditMember,
  removeAuditMember,
  type AuditMember,
} from "../support/member";

test("collaborative editing, public readonly share and offline interruption", async ({
  page,
  browser,
  context,
}, testInfo) => {
  const api = await createAdminApi();
  const state = await loadAuditState();
  const auditPage = await createPage(
    api,
    state.spaceId,
    `${testInfo.project.name} collaboration`,
    {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Collaboration anchor" }],
        },
      ],
    },
  );
  let member: AuditMember | undefined;
  let secondContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let shareId: string | undefined;

  try {
    member = await provisionAuditMember({
      api,
      browser,
      spaceId: state.spaceId,
      role: "writer",
    });
    secondContext = member.context;

    const secondPage = await secondContext.newPage();
    const url = pageUrl(state, auditPage);
    await Promise.all([page.goto(url), secondPage.goto(url)]);
    const adminEditor = mainEditor(page);
    const collaboratorEditor = mainEditor(secondPage);
    if ((await adminEditor.getAttribute("contenteditable")) !== "true") {
      await page
        .getByRole("radiogroup")
        .getByText(/^(Edit|Редактировать)$/)
        .click();
    }
    if ((await collaboratorEditor.getAttribute("contenteditable")) !== "true") {
      await secondPage
        .getByRole("radiogroup")
        .getByText(/^(Edit|Редактировать)$/)
        .click();
    }
    await expect(adminEditor).toHaveAttribute("contenteditable", "true");
    await expect(collaboratorEditor).toHaveAttribute("contenteditable", "true");
    if (!(await adminEditor.textContent())?.includes("Collaboration anchor")) {
      await recordDefect({
        id: "ED-001",
        title:
          "API-seeded page content is absent from the live collaborative Yjs editor",
        severity: "critical",
        project: testInfo.project.name,
        evidence:
          "Database page content contains the seeded paragraph, but the connected editable ProseMirror document is empty.",
      });
      await adminEditor.fill("Collaboration anchor");
    }
    await expect(collaboratorEditor).toContainText("Collaboration anchor");
    await mainEditor(page).click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" admin-edit");
    await expect(mainEditor(secondPage)).toContainText("admin-edit");
    await mainEditor(secondPage).click();
    await secondPage.keyboard.press("Control+End");
    await secondPage.keyboard.type(" collaborator-edit");
    await expect(mainEditor(page)).toContainText("collaborator-edit");
    await captureStep(page, testInfo, "06-collaboration-admin");
    await secondPage.close();

    const share = await apiPost<any>(api, "/api/shares/actions/create", {
      pageId: auditPage.id,
      includeSubPages: true,
      searchIndexing: false,
    });
    shareId = share.id;
    const publicContext = await browser.newContext({
      baseURL: baseUrl(),
      locale: "en-US",
    });
    const publicPage = await publicContext.newPage();
    await publicPage.goto(`/share/${share.id}/p/${auditPage.slugId}`);
    await expect(publicDocument(publicPage)).toContainText(
      "Collaboration anchor",
    );
    await expect(publicDocument(publicPage)).toHaveAttribute(
      "contenteditable",
      "false",
    );
    await captureStep(publicPage, testInfo, "07-public-readonly-share");
    await publicContext.close();

    await context.setOffline(true);
    const offlineRequestFailed = await page.evaluate(async () => {
      try {
        await fetch(`/api/users/me?editorAuditOffline=${Date.now()}`, {
          cache: "no-store",
        });
        return false;
      } catch {
        return true;
      }
    });
    expect(offlineRequestFailed).toBe(true);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    const offlineMessage = page
      .getByText(
        /You are offline|There is no network connection|^Offline$|Failed to load page/i,
      )
      .first();
    const offlineMessageVisible = await offlineMessage
      .waitFor({ state: "visible", timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (!offlineMessageVisible) {
      await recordDefect({
        id: "ED-008",
        title: "Offline reload has no explanatory fallback",
        severity: "medium",
        project: testInfo.project.name,
        evidence:
          "The offline request failed as expected, but after an offline reload the page still showed only an unlabeled loading spinner instead of an explanatory fallback.",
      });
    }
    await captureStep(page, testInfo, "08-offline-interruption");
    await context.setOffline(false);
    await page.reload();
    await expect(mainEditor(page)).toContainText("Collaboration anchor");
  } finally {
    await context.setOffline(false).catch(() => undefined);
    if (shareId) {
      await apiPost(api, "/api/shares/actions/delete", { shareId }).catch(
        () => undefined,
      );
    }
    await removeAuditMember(api, member);
    await api.dispose();
  }
});
