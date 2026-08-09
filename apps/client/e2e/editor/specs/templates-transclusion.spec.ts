import { randomUUID } from "node:crypto";
import {
  apiDelete,
  apiGet,
  apiPost,
  apiPostWithHeaders,
  createAdminApi,
  createPage,
  hashProseMirrorJson,
  loadAuditState,
  updatePageContent,
} from "../support/api";
import { captureStep, expect, mainEditor, test } from "../support/audit-test";
import {
  provisionAuditMember,
  removeAuditMember,
  type AuditMember,
} from "../support/member";

type Page = {
  id: string;
  slugId: string;
  title: string;
  spaceId: string;
  content?: Record<string, unknown>;
};

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

test("audits regular and synchronized template lifecycle and policies", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const api = await createAdminApi();
  const state = await loadAuditState();
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  let member: AuditMember | undefined;
  let groupId: string | undefined;
  let secondSpaceId: string | undefined;

  try {
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

    const sourceV1 = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: `Regular source v1 ${suffix}` }],
        },
      ],
    };
    const sourcePage = await createPage(
      api,
      state.spaceId,
      `Template source ${suffix}`,
      sourceV1,
    );
    const regularBlank = await apiPost<{ page: Page }>(
      api,
      "/api/pages/templates/actions/create",
      {
        spaceId: state.spaceId,
        kind: "regular",
        title: `Regular blank ${suffix}`,
      },
    );
    const regularFromSource = await apiPost<{ page: Page }>(
      api,
      "/api/pages/templates/actions/create",
      {
        spaceId: state.spaceId,
        kind: "regular",
        sourcePageId: sourcePage.id,
        title: `Regular sourced ${suffix}`,
      },
    );
    const syncedTemplate = await apiPost<{ page: Page }>(
      api,
      "/api/pages/templates/actions/create",
      {
        spaceId: state.spaceId,
        kind: "synced",
        sourcePageId: sourcePage.id,
        title: `Synchronized ${suffix}`,
      },
    );

    const syncedDraftInfo = await apiGet<Page>(
      api,
      `/api/pages/info?pageId=${syncedTemplate.page.id}`,
    );
    expect(nodeTypes(syncedDraftInfo.content)).toContain(
      "templateManagedBlock",
    );
    expect(nodeTypes(syncedDraftInfo.content)).not.toContain("pageEmbed");

    const fieldId = randomUUID();
    const blockId = randomUUID();
    const syncedV1 = {
      type: "doc",
      content: [
        {
          type: "templateManagedBlock",
          attrs: { templateBlockId: blockId, locked: false },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: `Managed v1 ${suffix}` }],
            },
          ],
        },
        {
          type: "templateField",
          attrs: {
            fieldId,
            label: "Audit owner",
            placeholder: "Enter an owner",
          },
          content: [{ type: "paragraph" }],
        },
      ],
    };
    await updatePageContent(api, syncedTemplate.page.id, syncedV1);
    const firstPreflight = await apiPost<any>(
      api,
      `/api/pages/templates/${syncedTemplate.page.id}/actions/preflight-publish`,
      {},
    );
    expect(firstPreflight.nextRevision).toBe(1);
    const firstPublish = await apiPost<any>(
      api,
      `/api/pages/templates/${syncedTemplate.page.id}/actions/publish`,
      { draftHash: firstPreflight.draftHash },
    );
    expect(firstPublish.revision.revision).toBe(1);
    expect(firstPublish.syncRun.status).toBe("completed");

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

    const blankInstance = await apiPostWithHeaders<{ page: Page }>(
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
    const newRegular = await apiPostWithHeaders<{ page: Page }>(
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

    const syncedInstance = await apiPostWithHeaders<{ page: Page }>(
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
    const secondPublish = await apiPost<any>(
      api,
      `/api/pages/templates/${syncedTemplate.page.id}/actions/publish`,
      { draftHash: secondPreflight.draftHash },
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
    const synchronizedContent = (
      await apiGet<Page>(
        api,
        `/api/pages/info?pageId=${syncedInstance.page.id}`,
      )
    ).content!;
    expect(documentText(synchronizedContent)).toContain(
      `Member value ${suffix}`,
    );

    const revisions = await apiGet<any>(
      api,
      `/api/pages/templates/${syncedTemplate.page.id}/revisions`,
    );
    expect(revisions.items.map((item: any) => item.revision)).toEqual([2, 1]);
    const retry = await apiPost<any>(
      api,
      `/api/pages/templates/${syncedTemplate.page.id}/sync-runs/${secondPublish.syncRun.id}/actions/retry`,
      {},
    );
    expect(retry.accepted).toBe(true);

    const duplicate = await apiPost<Page>(api, "/api/pages/duplicate", {
      pageId: syncedInstance.page.id,
    });
    const duplicateProvenance = await apiGet<any>(
      api,
      `/api/pages/templates/${duplicate.id}/provenance`,
    );
    expect(duplicateProvenance.createdFromTemplate).toBe(false);

    const detach = await apiPostWithHeaders<any>(
      api,
      `/api/pages/${syncedInstance.page.id}/actions/detach-template`,
      {
        confirmed: true,
        baseContentHash: hashProseMirrorJson(synchronizedContent),
      },
      { "Idempotency-Key": randomUUID() },
    );
    expect(detach.detached).toBe(true);
    const detached = await apiGet<Page>(
      api,
      `/api/pages/info?pageId=${syncedInstance.page.id}`,
    );
    expect(nodeTypes(detached.content)).not.toContain("templateManagedBlock");
    expect(nodeTypes(detached.content)).not.toContain("templateField");

    const groupPolicy = await apiGet<any>(
      api,
      `/api/pages/templates/policies/spaces/${state.spaceId}/groups/${groupId}`,
    );
    await api
      .put(
        `/api/pages/templates/policies/spaces/${state.spaceId}/groups/${groupId}`,
        {
          data: {
            allowedActions: ["use_regular_template"],
            expectedRevision: groupPolicy.revision,
          },
        },
      )
      .then(async (response) => {
        expect(response.ok()).toBe(true);
        await response.dispose();
      });
    const memberCatalog = await member.get<any>(
      `/api/pages/templates?spaceId=${state.spaceId}&limit=50`,
    );
    expect(memberCatalog.capabilities.useRegular).toBe(true);
    expect(memberCatalog.capabilities.useSynced).toBe(false);
    expect(
      await responseStatus(
        member.context.request.get("/api/pages/templates/policies/workspace"),
      ),
    ).toBe(403);
    await expect(
      member.post("/api/pages/templates/actions/create", {
        spaceId: state.spaceId,
        kind: "regular",
        title: `Denied member template ${suffix}`,
      }),
    ).rejects.toThrow(/403/);
    const memberRegular = await member.post<{ page: Page }>(
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
      member.post(
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
    await captureStep(page, testInfo, "templates-catalog");

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

    await page.goto(`/s/${state.spaceSlug}/p/${sourcePage.slugId}`);
    await expect(mainEditor(page)).toContainText(`Regular source v1 ${suffix}`);
  } finally {
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
    await api.dispose();
  }
});
