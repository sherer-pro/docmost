import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import {
  apiDelete,
  apiGet,
  apiPost,
  apiPostWithHeaders,
  createAdminApi,
  createPage,
  loadAuditState,
  updatePageContent,
} from "../support/api";
import {
  captureStep,
  expect,
  mainEditor,
  runAxe,
  test,
} from "../support/audit-test";
import {
  provisionAuditMember,
  removeAuditMember,
  type AuditMember,
} from "../support/member";

test.use({ serviceWorkers: "block" });

type Page = {
  id: string;
  slugId: string;
  title: string;
  spaceId: string;
  content?: Record<string, unknown>;
};

type CreatedPage = { page: Page };

function documentText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const node = content as { text?: unknown; content?: unknown[] };
  return [
    typeof node.text === "string" ? node.text : "",
    ...(node.content ?? []).map(documentText),
  ].join(" ");
}

function nodeTypes(content: unknown, result = new Set<string>()): Set<string> {
  if (!content || typeof content !== "object") return result;
  const node = content as { type?: unknown; content?: unknown[] };
  if (typeof node.type === "string") result.add(node.type);
  for (const child of node.content ?? []) nodeTypes(child, result);
  return result;
}

async function responseStatus(
  responsePromise: Promise<import("@playwright/test").APIResponse>,
): Promise<number> {
  const response = await responsePromise;
  await response.dispose();
  return response.status();
}

test.describe("page template lifecycle", () => {
  test.describe.configure({ mode: "serial" });

  let api: Awaited<ReturnType<typeof createAdminApi>>;
  let state: Awaited<ReturnType<typeof loadAuditState>>;
  let suffix: string;
  let member: AuditMember | undefined;
  let groupId: string | undefined;
  let secondSpaceId: string | undefined;
  let sourcePage: Page;
  let regularBlank: CreatedPage;
  let regularFromSource: CreatedPage;
  let syncedTemplate: CreatedPage;
  let syncedV1: Record<string, any>;
  let syncedInstance: CreatedPage;
  let synchronizedContent: Record<string, unknown>;
  let secondPublish: any;
  let originalLocale: string | undefined;
  const uiCreatedTemplateIds: string[] = [];

  test.beforeAll(async ({ browser }, testInfo) => {
    api = await createAdminApi();
    const currentUser = await apiGet<any>(api, "/api/users/me");
    originalLocale = currentUser.user.locale;
    await apiPost(api, "/api/users/update", { locale: "en-US" });
    state = await loadAuditState();
    suffix = `${testInfo.project.name}-${Date.now()}`;
    member = await provisionAuditMember({
      api,
      browser,
      spaceId: state.spaceId,
      role: "writer",
    });
    const group = await apiPost<{ id: string }>(
      api,
      "/api/groups/actions/create",
      {
        name: `Template audit ${suffix}`,
        userIds: [member.userId],
      },
    );
    groupId = group.id;
    await apiPost(api, "/api/spaces/members/add", {
      spaceId: state.spaceId,
      role: "writer",
      userIds: [],
      groupIds: [group.id],
    });

    sourcePage = await createPage(
      api,
      state.spaceId,
      `Template source ${suffix}`,
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: `Regular source v1 ${suffix}` }],
          },
        ],
      },
    );
    regularBlank = await apiPostWithHeaders<CreatedPage>(
      api,
      "/api/pages/templates/actions/create",
      {
        spaceId: state.spaceId,
        kind: "regular",
        title: `Regular blank ${suffix}`,
      },
      { "Idempotency-Key": randomUUID() },
    );
    regularFromSource = await apiPostWithHeaders<CreatedPage>(
      api,
      "/api/pages/templates/actions/create",
      {
        spaceId: state.spaceId,
        kind: "regular",
        sourcePageId: sourcePage.id,
        title: `Regular sourced ${suffix}`,
      },
      { "Idempotency-Key": randomUUID() },
    );
    syncedTemplate = await apiPostWithHeaders<CreatedPage>(
      api,
      "/api/pages/templates/actions/create",
      {
        spaceId: state.spaceId,
        kind: "synced",
        sourcePageId: sourcePage.id,
        title: `Synchronized ${suffix}`,
      },
      { "Idempotency-Key": randomUUID() },
    );
  });

  test.afterAll(async () => {
    if (!api) return;
    for (const templateId of uiCreatedTemplateIds) {
      await apiPost(
        api,
        `/api/pages/templates/${templateId}/actions/archive`,
        {},
      ).catch(() => undefined);
    }
    if (secondSpaceId) {
      await apiDelete(api, `/api/spaces/${secondSpaceId}`).catch(
        () => undefined,
      );
    }
    if (groupId) {
      await apiPost(api, "/api/groups/actions/delete", { groupId }).catch(
        () => undefined,
      );
    }
    await removeAuditMember(api, member);
    if (originalLocale) {
      await apiPost(api, "/api/users/update", {
        locale: originalLocale,
      }).catch(() => undefined);
    }
    await api.dispose();
  });

  test("creates and uses templates through the two-step UI", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const createdByKind = new Map<"regular" | "synced", Page>();

    for (const kind of ["regular", "synced"] as const) {
      const title = `UI ${kind} ${suffix}`;
      await page.goto(`/s/${state.spaceSlug}/templates`);
      await page.getByRole("button", { name: "Create template" }).click();
      const dialog = page.getByRole("dialog", { name: "Create template" });
      await dialog.getByRole("textbox", { name: "Template name" }).fill(title);
      await dialog.getByText("Use an existing page", { exact: true }).click();
      await dialog
        .getByRole("textbox", { name: "Search pages" })
        .fill(sourcePage.title);
      await dialog.getByRole("button", { name: sourcePage.title }).click();
      await expect(
        dialog.getByRole("textbox", { name: "Template name" }),
      ).toHaveValue(title);
      await dialog.getByRole("button", { name: "Next" }).click();
      await dialog
        .getByRole("button", {
          name: kind === "regular" ? /Independent copy/ : /Linked page/,
        })
        .click();
      await Promise.all([
        page.waitForURL(new RegExp(`/s/${state.spaceSlug}/p/`)),
        dialog.getByRole("button", { name: "Create template" }).click(),
      ]);

      const catalog = await apiGet<{ items: Page[] }>(
        api,
        `/api/pages/templates?spaceId=${state.spaceId}&query=${encodeURIComponent(title)}&limit=20`,
      );
      const created = catalog.items.find((item) => item.title === title);
      expect(created).toBeTruthy();
      createdByKind.set(kind, created!);
      uiCreatedTemplateIds.push(created!.id);
    }

    const regular = createdByKind.get("regular")!;
    const instanceTitle = `UI regular instance ${suffix}`;
    await page.goto(`/s/${state.spaceSlug}/templates`);
    const search = page.getByRole("textbox", { name: "Search templates" });
    await search.fill(regular.title);
    const row = page
      .getByRole("button")
      .filter({ hasText: regular.title })
      .first();
    await expect(row).toBeVisible();
    await row
      .locator("xpath=following-sibling::*[1]")
      .getByRole("button", { name: "Use", exact: true })
      .click();
    const useDialog = page.getByRole("dialog", {
      name: "Create page from template",
    });
    await useDialog
      .getByRole("textbox", { name: "Page title" })
      .fill(instanceTitle);
    const rootDestination = useDialog.getByRole("button", {
      name: /Space root/,
    });
    await expect(rootDestination).toBeVisible();
    await rootDestination.click();
    await Promise.all([
      page.waitForURL(new RegExp(`/s/${state.spaceSlug}/p/`)),
      useDialog.getByRole("button", { name: "Create page" }).click(),
    ]);
    await expect(page.getByText(instanceTitle).first()).toBeVisible();
  });

  test("catalog is searchable, keyboard reachable, accessible, and responsive", async ({
    page,
  }, testInfo) => {
    const catalog = await apiGet<any>(
      api,
      `/api/pages/templates?spaceId=${state.spaceId}&limit=50`,
    );
    expect(catalog.items.map((item: any) => item.id)).toEqual(
      expect.arrayContaining([
        regularBlank.page.id,
        regularFromSource.page.id,
        syncedTemplate.page.id,
      ]),
    );

    await page.goto(`/s/${state.spaceSlug}/templates`);
    await expect(page.getByText(regularFromSource.page.title)).toBeVisible();
    await expect(page.getByText(syncedTemplate.page.title)).toBeVisible();

    const search = page.getByRole("textbox", { name: "Search templates" });
    await search.focus();
    await page.keyboard.type("Synchronized");
    await expect(page.getByText(syncedTemplate.page.title)).toBeVisible();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await expect(page.getByText(regularFromSource.page.title)).toBeVisible();

    const templateRow = page
      .getByRole("button")
      .filter({ hasText: regularFromSource.page.title })
      .first();
    await templateRow.focus();
    await page.keyboard.press("Enter");
    const detailsDialog = page
      .locator('[role="dialog"]:visible')
      .filter({ hasText: regularFromSource.page.title });
    await expect(detailsDialog).toContainText(regularFromSource.page.title);
    await page.keyboard.press("Escape");
    await expect(templateRow).toBeFocused();

    testInfo.annotations.push({
      type: "zoom",
      description:
        "A 720 CSS-pixel viewport exercises the effective layout width of a 1440px viewport at 200% browser zoom.",
    });
    for (const width of [320, 390, 720, 767, 768, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                document.documentElement.scrollWidth >
                document.documentElement.clientWidth + 1,
            ),
          {
            message: `horizontal overflow at ${width}px`,
          },
        )
        .toBe(false);
    }
    expect(
      (await runAxe(page, testInfo, "main", "templates-catalog")).violations,
    ).toEqual([]);
    await captureStep(page, testInfo, "templates-catalog", {
      fullPage: testInfo.project.name.startsWith("mobile"),
    });
  });

  test("regular templates create stable independent copies", async () => {
    const regularKey = randomUUID();
    const regularInstance = await apiPostWithHeaders<{
      page: Page;
      idempotent: boolean;
    }>(
      api,
      "/api/pages/actions/create-from-template",
      {
        templatePageId: regularFromSource.page.id,
        spaceId: state.spaceId,
        title: `Regular instance ${suffix}`,
      },
      { "Idempotency-Key": regularKey },
    );
    const regularReplay = await apiPostWithHeaders<{
      page: Page;
      idempotent: boolean;
    }>(
      api,
      "/api/pages/actions/create-from-template",
      {
        templatePageId: regularFromSource.page.id,
        spaceId: state.spaceId,
        title: `Regular instance ${suffix}`,
      },
      { "Idempotency-Key": regularKey },
    );
    expect(regularReplay.page.id).toBe(regularInstance.page.id);
    expect(regularReplay.idempotent).toBe(true);

    const blankInstance = await apiPostWithHeaders<CreatedPage>(
      api,
      "/api/pages/actions/create-from-template",
      {
        templatePageId: regularBlank.page.id,
        spaceId: state.spaceId,
        title: `Blank instance ${suffix}`,
      },
      { "Idempotency-Key": randomUUID() },
    );
    const blankInfo = await apiGet<Page>(
      api,
      `/api/pages/info?pageId=${blankInstance.page.id}`,
    );
    expect(documentText(blankInfo.content).trim()).toBe("");

    await updatePageContent(api, regularFromSource.page.id, {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: `Regular source v2 ${suffix}` }],
        },
      ],
    });
    const existingRegular = await apiGet<Page>(
      api,
      `/api/pages/info?pageId=${regularInstance.page.id}`,
    );
    expect(documentText(existingRegular.content)).toContain(
      `Regular source v1 ${suffix}`,
    );
    expect(documentText(existingRegular.content)).not.toContain(
      `Regular source v2 ${suffix}`,
    );

    const newRegular = await apiPostWithHeaders<CreatedPage>(
      api,
      "/api/pages/actions/create-from-template",
      {
        templatePageId: regularFromSource.page.id,
        spaceId: state.spaceId,
        title: `Regular instance v2 ${suffix}`,
      },
      { "Idempotency-Key": randomUUID() },
    );
    expect(
      documentText(
        (
          await apiGet<Page>(
            api,
            `/api/pages/info?pageId=${newRegular.page.id}`,
          )
        ).content,
      ),
    ).toContain(`Regular source v2 ${suffix}`);
  });

  test("synchronized template publishing exposes status and inline history", async ({
    page,
  }, testInfo) => {
    const syncedDraftInfo = await apiGet<Page>(
      api,
      `/api/pages/info?pageId=${syncedTemplate.page.id}`,
    );
    expect(nodeTypes(syncedDraftInfo.content)).toContain(
      "templateManagedBlock",
    );
    expect(nodeTypes(syncedDraftInfo.content)).not.toContain("pageEmbed");

    syncedV1 = {
      type: "doc",
      content: [
        {
          type: "templateManagedBlock",
          attrs: { templateBlockId: randomUUID(), locked: false },
          content: [
            {
              type: "paragraph",
              attrs: { id: randomUUID(), indent: 0 },
              content: [{ type: "text", text: `Managed v1 ${suffix}` }],
            },
          ],
        },
        {
          type: "templateField",
          attrs: {
            fieldId: randomUUID(),
            label: "Audit owner",
            placeholder: "Enter an owner",
          },
          content: [
            {
              type: "paragraph",
              attrs: { id: randomUUID(), indent: 0 },
            },
          ],
        },
      ],
    };
    await updatePageContent(api, syncedTemplate.page.id, syncedV1);
    await page.goto(`/s/${state.spaceSlug}/p/${syncedTemplate.page.slugId}`);
    const statusBar = page.locator('section[aria-label="Template editor"]');
    await expect(statusBar).toContainText("Linked page");
    const reviewButton = statusBar.getByRole("button", {
      name: "Review and publish",
    });
    const publishDialog = page
      .locator('[role="dialog"]:visible')
      .filter({ hasText: "Publish template version 1" });
    await expect
      .poll(
        async () => {
          if (await publishDialog.isVisible()) return true;
          if (await reviewButton.isEnabled()) await reviewButton.click();
          return publishDialog.isVisible();
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    await expect(publishDialog).toContainText("Template blocks");
    await publishDialog
      .getByRole("button", { name: "Publish version 1" })
      .click();
    await expect(statusBar).toContainText("Published v1");
    await expect(statusBar.getByText("Saved", { exact: true })).toBeVisible();
    await expect(
      statusBar.getByRole("button", { name: "History" }),
    ).toBeVisible();
    await statusBar.getByRole("button", { name: "History" }).click();
    const history = page
      .locator('[role="dialog"]:visible')
      .filter({ hasText: "Template history" });
    await expect(history).toContainText("Template history");
    await expect(history).toContainText("Version 1");
    await history.getByRole("button", { name: "View" }).click();
    const comparison = page
      .locator('[role="dialog"]:visible')
      .filter({ hasText: "Back" });
    await expect(comparison).toHaveCount(1);
    await expect(comparison).toContainText("Back");
    await page.keyboard.press("Escape");
    expect(
      (
        await runAxe(
          page,
          testInfo,
          'section[aria-label="Template editor"]',
          "template-editor-status",
        )
      ).violations,
    ).toEqual([]);
  });

  test("linked instances preserve fields, block unsafe operations, and detach", async ({
    page,
  }, testInfo) => {
    test.setTimeout(150_000);
    syncedInstance = await apiPostWithHeaders<CreatedPage>(
      api,
      "/api/pages/actions/create-from-template",
      {
        templatePageId: syncedTemplate.page.id,
        spaceId: state.spaceId,
        title: `Synchronized instance ${suffix}`,
      },
      { "Idempotency-Key": randomUUID() },
    );
    const syncedInstanceInfo = await apiGet<Page>(
      api,
      `/api/pages/info?pageId=${syncedInstance.page.id}`,
    );
    const filledInstance = structuredClone(syncedInstanceInfo.content!);
    const editableField = (filledInstance.content as any[]).find(
      (node) => node.type === "templateField",
    );
    expect(editableField).toBeTruthy();
    editableField.content = [
      {
        type: "paragraph",
        content: [{ type: "text", text: `Member value ${suffix}` }],
      },
    ];
    await updatePageContent(api, syncedInstance.page.id, filledInstance);

    const managedMutation = structuredClone(filledInstance);
    const managedBlock = (managedMutation.content as any[]).find(
      (node) => node.type === "templateManagedBlock",
    );
    managedBlock.content = [
      {
        type: "paragraph",
        content: [{ type: "text", text: `Bypass managed value ${suffix}` }],
      },
    ];
    expect(
      await responseStatus(
        api.post("/api/pages/actions/update", {
          data: {
            pageId: syncedInstance.page.id,
            content: managedMutation,
            format: "json",
            operation: "replace",
          },
        }),
      ),
    ).toBe(409);

    const nestedServiceMutation = structuredClone(filledInstance);
    const nestedField = (nestedServiceMutation.content as any[]).find(
      (node) => node.type === "templateField",
    );
    nestedField.content = [
      {
        type: "templateManagedBlock",
        attrs: { templateBlockId: randomUUID(), locked: true },
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: `Nested bypass ${suffix}` }],
          },
        ],
      },
    ];
    expect(
      await responseStatus(
        api.post("/api/pages/actions/update", {
          data: {
            pageId: syncedInstance.page.id,
            content: nestedServiceMutation,
            format: "json",
            operation: "replace",
          },
        }),
      ),
    ).toBe(409);

    const contentAfterBypasses = (
      await apiGet<Page>(
        api,
        `/api/pages/info?pageId=${syncedInstance.page.id}`,
      )
    ).content;
    expect(documentText(contentAfterBypasses)).toContain(
      `Managed v1 ${suffix}`,
    );
    expect(documentText(contentAfterBypasses)).toContain(
      `Member value ${suffix}`,
    );
    expect(documentText(contentAfterBypasses)).not.toContain(
      `Bypass managed value ${suffix}`,
    );
    expect(documentText(contentAfterBypasses)).not.toContain(
      `Nested bypass ${suffix}`,
    );

    const syncedV2 = {
      ...syncedV1,
      content: [
        {
          ...syncedV1.content[0],
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: `Managed v2 ${suffix}` }],
            },
          ],
        },
        syncedV1.content[1],
      ],
    };
    await updatePageContent(api, syncedTemplate.page.id, syncedV2);
    const secondPreflight = await apiPost<any>(
      api,
      `/api/pages/templates/${syncedTemplate.page.id}/actions/preflight-publish`,
      {},
    );
    secondPublish = await apiPostWithHeaders<any>(
      api,
      `/api/pages/templates/${syncedTemplate.page.id}/actions/publish`,
      { draftHash: secondPreflight.draftHash },
      { "Idempotency-Key": randomUUID() },
    );
    expect(secondPublish.revision.revision).toBe(2);
    await expect
      .poll(async () => {
        const content = (
          await apiGet<Page>(
            api,
            `/api/pages/info?pageId=${syncedInstance.page.id}`,
          )
        ).content;
        return documentText(content);
      })
      .toContain(`Managed v2 ${suffix}`);
    synchronizedContent = (
      await apiGet<Page>(
        api,
        `/api/pages/info?pageId=${syncedInstance.page.id}`,
      )
    ).content!;
    expect(documentText(synchronizedContent)).toContain(
      `Member value ${suffix}`,
    );

    const exportResponse = await api.post("/api/pages/actions/export", {
      data: {
        pageId: syncedInstance.page.id,
        format: "docmost",
        includeChildren: false,
        includeAttachments: false,
      },
    });
    expect(exportResponse.ok(), "synchronized Docmost export status").toBe(
      true,
    );
    const exportZip = await JSZip.loadAsync(await exportResponse.body());
    const exportData = JSON.parse(
      await exportZip.file("docmost-data.json")!.async("string"),
    );
    const exportedInstance = exportData.pages.find(
      (exportedPage: Page) => exportedPage.id === syncedInstance.page.id,
    );
    expect(exportedInstance).toBeTruthy();
    expect(documentText(exportedInstance.content)).toContain(
      `Managed v2 ${suffix}`,
    );
    expect(documentText(exportedInstance.content)).toContain(
      `Member value ${suffix}`,
    );
    expect(nodeTypes(exportedInstance.content)).not.toContain(
      "templateManagedBlock",
    );
    expect(nodeTypes(exportedInstance.content)).not.toContain("templateField");

    expect(
      await responseStatus(
        api.post("/api/pages/duplicate", {
          data: { pageId: syncedInstance.page.id },
        }),
      ),
    ).toBe(409);
    const independentKey = randomUUID();
    const independentCopy = await apiPostWithHeaders<{
      page: Page;
      idempotent: boolean;
    }>(
      api,
      `/api/pages/${syncedInstance.page.id}/actions/create-independent-copy`,
      {},
      { "Idempotency-Key": independentKey },
    );
    const independentReplay = await apiPostWithHeaders<{
      page: Page;
      idempotent: boolean;
    }>(
      api,
      `/api/pages/${syncedInstance.page.id}/actions/create-independent-copy`,
      {},
      { "Idempotency-Key": independentKey },
    );
    expect(independentReplay.page.id).toBe(independentCopy.page.id);
    expect(independentReplay.idempotent).toBe(true);
    const independentProvenance = await apiGet<any>(
      api,
      `/api/pages/templates/${independentCopy.page.id}/provenance`,
    );
    expect(independentProvenance.createdFromTemplate).toBe(false);

    await page.goto(`/s/${state.spaceSlug}/p/${syncedInstance.page.slugId}`);
    const instanceStatus = page.locator(
      'section[aria-label="Linked template status"]',
    );
    await expect(instanceStatus).toContainText(syncedTemplate.page.title);
    await expect(instanceStatus).toContainText("Version 2 of 2");
    await expect(
      instanceStatus.getByRole("button", { name: "Create independent copy" }),
    ).toBeVisible();
    expect(
      (
        await runAxe(
          page,
          testInfo,
          'section[aria-label="Linked template status"]',
          "linked-instance-status",
        )
      ).violations,
    ).toEqual([]);
    await captureStep(page, testInfo, "template-linked-instance");

    await instanceStatus.getByRole("button", { name: "Detach" }).click();
    const detachDialog = page
      .locator('[role="dialog"]:visible')
      .filter({ hasText: "Detach from linked template?" });
    await expect(detachDialog).toContainText("Detach from linked template?");
    await detachDialog
      .getByRole("checkbox", {
        name: "I understand this action is irreversible",
      })
      .check();
    const detachButton = detachDialog.getByRole("button", {
      name: "Detach and keep this page",
    });
    await expect(detachButton).toBeEnabled();
    await detachButton.click();
    await expect(page.getByText("Page detached from template")).toBeVisible();

    const detached = await apiGet<Page>(
      api,
      `/api/pages/info?pageId=${syncedInstance.page.id}`,
    );
    expect(nodeTypes(detached.content)).not.toContain("templateManagedBlock");
    expect(nodeTypes(detached.content)).not.toContain("templateField");
  });

  test("policies enforce role and cross-space boundaries", async () => {
    const groupPolicy = await apiGet<any>(
      api,
      `/api/pages/templates/policies/spaces/${state.spaceId}/groups/${groupId}`,
    );
    const policyResponse = await api.put(
      `/api/pages/templates/policies/spaces/${state.spaceId}/groups/${groupId}`,
      {
        data: {
          allowedActions: ["use_regular_template"],
          expectedRevision: groupPolicy.revision,
        },
      },
    );
    expect(policyResponse.ok()).toBe(true);
    await policyResponse.dispose();

    const memberCatalog = await member!.get<any>(
      `/api/pages/templates?spaceId=${state.spaceId}&limit=50`,
    );
    expect(memberCatalog.capabilities.useRegular).toBe(true);
    expect(memberCatalog.capabilities.useSynced).toBe(false);
    expect(
      await responseStatus(
        member!.context.request.get("/api/pages/templates/policies/workspace"),
      ),
    ).toBe(403);
    await expect(
      member!.post(
        "/api/pages/templates/actions/create",
        {
          spaceId: state.spaceId,
          kind: "regular",
          title: `Denied member template ${suffix}`,
        },
        { "Idempotency-Key": randomUUID() },
      ),
    ).rejects.toThrow(/403/);
    const memberRegular = await member!.post<CreatedPage>(
      "/api/pages/actions/create-from-template",
      {
        templatePageId: regularFromSource.page.id,
        spaceId: state.spaceId,
        title: `Member regular ${suffix}`,
      },
      { "Idempotency-Key": randomUUID() },
    );
    expect(memberRegular.page.id).toBeTruthy();
    await expect(
      member!.post(
        "/api/pages/actions/create-from-template",
        {
          templatePageId: syncedTemplate.page.id,
          spaceId: state.spaceId,
          title: `Member synced denied ${suffix}`,
        },
        { "Idempotency-Key": randomUUID() },
      ),
    ).rejects.toThrow(/403/);

    const secondSpace = await apiPost<{ id: string }>(api, "/api/spaces", {
      name: `Template cross-space ${suffix}`,
      slug: `templatecross${Date.now()}`,
      description: "Temporary cross-space template audit fixture.",
    });
    secondSpaceId = secondSpace.id;
    await expect(
      apiPostWithHeaders(
        api,
        "/api/pages/actions/create-from-template",
        {
          templatePageId: regularFromSource.page.id,
          spaceId: secondSpaceId,
        },
        { "Idempotency-Key": randomUUID() },
      ),
    ).rejects.toThrow(/404/);
  });

  test("recovery retries provenance and protects completed synchronization before archival", async ({
    page,
  }, testInfo) => {
    expect(
      await responseStatus(
        api.post(
          `/api/pages/templates/${syncedTemplate.page.id}/sync-runs/${secondPublish.syncRun.id}/actions/retry`,
          { data: {} },
        ),
      ),
    ).toBe(409);

    const recoveryInstance = await apiPostWithHeaders<CreatedPage>(
      api,
      "/api/pages/actions/create-from-template",
      {
        templatePageId: syncedTemplate.page.id,
        spaceId: state.spaceId,
        title: `Recovery instance ${suffix}`,
      },
      { "Idempotency-Key": randomUUID() },
    );
    const provenanceRoute = `**/api/pages/templates/${recoveryInstance.page.id}/provenance`;
    await page.route(provenanceRoute, async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "temporary audit failure" }),
      });
    });
    await page.goto(`/s/${state.spaceSlug}/p/${recoveryInstance.page.slugId}`);
    await expect(
      page.getByText("Could not load template details."),
    ).toBeVisible();
    expect(
      (
        await runAxe(
          page,
          testInfo,
          'section[aria-label="Linked template status"]',
          "provenance-recovery",
        )
      ).violations,
    ).toEqual([]);
    await page.unroute(provenanceRoute);
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(
      page.locator('section[aria-label="Linked template status"]'),
    ).toContainText("Up to date");

    const revisions = await apiGet<any>(
      api,
      `/api/pages/templates/${syncedTemplate.page.id}/revisions`,
    );
    expect(revisions.items.map((item: any) => item.revision)).toEqual([2, 1]);

    for (const templatePageId of [
      regularBlank.page.id,
      regularFromSource.page.id,
      syncedTemplate.page.id,
    ]) {
      const archived = await apiPost<any>(
        api,
        `/api/pages/templates/${templatePageId}/actions/archive`,
        {},
      );
      expect(archived.archived).toBe(true);
    }
    const archivedCatalog = await apiGet<any>(
      api,
      `/api/pages/templates?spaceId=${state.spaceId}&includeArchived=true&limit=50`,
    );
    expect(
      archivedCatalog.items.find(
        (item: any) => item.id === regularFromSource.page.id,
      ).archivedAt,
    ).toBeTruthy();
    await expect(
      apiPostWithHeaders(
        api,
        "/api/pages/actions/create-from-template",
        {
          templatePageId: regularFromSource.page.id,
          spaceId: state.spaceId,
        },
        { "Idempotency-Key": randomUUID() },
      ),
    ).rejects.toThrow(/409/);

    const restored = await apiPost<any>(
      api,
      `/api/pages/templates/${regularFromSource.page.id}/actions/restore`,
      {},
    );
    expect(restored).toMatchObject({
      archived: false,
      archiveState: "active",
    });
    const restoredInstance = await apiPostWithHeaders<CreatedPage>(
      api,
      "/api/pages/actions/create-from-template",
      {
        templatePageId: regularFromSource.page.id,
        spaceId: state.spaceId,
        title: `Restored template instance ${suffix}`,
      },
      { "Idempotency-Key": randomUUID() },
    );
    expect(restoredInstance.page.id).toBeTruthy();

    await page.goto(`/s/${state.spaceSlug}/p/${sourcePage.slugId}`);
    await expect(mainEditor(page)).toContainText(`Regular source v1 ${suffix}`);
  });
});
