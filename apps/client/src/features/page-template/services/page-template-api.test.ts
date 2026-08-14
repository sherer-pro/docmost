// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import api from "@/lib/api-client";
import {
  formatTemplateDraftId,
  serializeTemplateDraftSeed,
} from "@docmost/editor-ext";
import {
  discoverPageTemplates,
  archivePageTemplate,
  createIndependentPageCopy,
  getPageTemplateDestinations,
  getPageTemplatePolicyGroups,
  getPageTemplateCapabilities,
  createPageFromTemplate,
  preflightPageTemplatePublish,
  restorePageTemplate,
  updatePageTemplateSpacePolicy,
} from "./page-template-api";
import {
  hashNormalizedTemplateDraft,
  hashProseMirrorJson,
  hashTemplateInstanceContent,
} from "./page-template-draft-hash";

vi.mock("@/lib/api-client", () => ({
  default: { post: vi.fn(), get: vi.fn(), put: vi.fn(), patch: vi.fn() },
}));

const post = vi.mocked(api.post);
const get = vi.mocked(api.get);
const put = vi.mocked(api.put);

describe("page template idempotency", () => {
  beforeEach(() => {
    post.mockReset();
    get.mockReset();
    put.mockReset();
    sessionStorage.clear();
  });

  it("reuses the same key after a lost response and clears it after success", async () => {
    post
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ data: { page: { id: "page" } } } as any)
      .mockResolvedValueOnce({ data: { page: { id: "page-2" } } } as any);
    const request = {
      templatePageId: "source",
      spaceId: "space",
      parentPageId: "parent",
    };

    await expect(createPageFromTemplate(request)).rejects.toThrow("network");
    await expect(createPageFromTemplate(request)).resolves.toEqual({
      page: { id: "page" },
    });

    const firstKey = post.mock.calls[0][2]?.headers?.["Idempotency-Key"];
    const retryKey = post.mock.calls[1][2]?.headers?.["Idempotency-Key"];
    expect(retryKey).toBe(firstKey);

    await createPageFromTemplate(request);
    const nextOperationKey =
      post.mock.calls[2][2]?.headers?.["Idempotency-Key"];
    expect(nextOperationKey).not.toBe(firstKey);
  });

  it("passes the required spaceId to discovery and destinations", async () => {
    get.mockResolvedValue({ data: { items: [], nextCursor: null } } as any);

    await discoverPageTemplates({
      spaceId: "space-1",
      query: "plan",
      cursor: "next",
      limit: 20,
    });
    await getPageTemplateDestinations({
      spaceId: "space-1",
      query: "parent",
      limit: 50,
    });

    expect(get).toHaveBeenNthCalledWith(1, "/pages/templates", {
      params: {
        spaceId: "space-1",
        query: "plan",
        cursor: "next",
        limit: 20,
      },
    });
    expect(get).toHaveBeenNthCalledWith(2, "/pages/templates/destinations", {
      params: { spaceId: "space-1", query: "parent", limit: 50 },
    });
  });

  it("uses the dedicated capabilities endpoint and preserves manage access", async () => {
    get.mockResolvedValue({
      data: {
        capabilities: {
          enabled: true,
          createTemplate: false,
          manageTemplate: true,
          useRegular: true,
          useSynced: false,
        },
      },
    } as any);

    await expect(getPageTemplateCapabilities("space-1")).resolves.toEqual({
      enabled: true,
      createTemplate: false,
      manageTemplate: true,
      useRegular: true,
      useSynced: false,
    });
    expect(get).toHaveBeenCalledWith("/pages/templates/capabilities", {
      params: { spaceId: "space-1" },
    });
  });

  it("fails closed when a capability field is missing", async () => {
    get.mockResolvedValue({
      data: {
        capabilities: {
          enabled: true,
          createTemplate: true,
          useRegular: true,
          useSynced: true,
        },
      },
    } as any);

    await expect(getPageTemplateCapabilities("space-1")).resolves.toEqual({
      enabled: true,
      createTemplate: true,
      manageTemplate: false,
      useRegular: true,
      useSynced: true,
    });
  });

  it("passes catalog archive mode and source discovery purpose", async () => {
    get.mockResolvedValue({
      data: {
        items: [],
        nextCursor: null,
        capabilities: { enabled: true },
      },
    } as any);

    await discoverPageTemplates({
      spaceId: "space-1",
      archiveState: "archived",
      kind: "synced",
      limit: 20,
    });
    await getPageTemplateDestinations({
      spaceId: "space-1",
      purpose: "source",
      pageId: "11111111-1111-1111-1111-111111111111",
      cursor: "next",
      limit: 20,
    });

    expect(get).toHaveBeenNthCalledWith(1, "/pages/templates", {
      params: {
        spaceId: "space-1",
        archiveState: "archived",
        kind: "synced",
        limit: 20,
      },
    });
    expect(get).toHaveBeenNthCalledWith(2, "/pages/templates/destinations", {
      params: {
        spaceId: "space-1",
        purpose: "source",
        pageId: "11111111-1111-1111-1111-111111111111",
        cursor: "next",
        limit: 20,
      },
    });
  });

  it("lists every group available to a space policy administrator", async () => {
    get.mockResolvedValue({
      data: { items: [{ id: "group-1", name: "Editors" }] },
    } as any);

    await expect(
      getPageTemplatePolicyGroups("space-1", {
        query: "edit",
        cursor: "next",
        limit: 50,
      }),
    ).resolves.toEqual({
      items: [{ id: "group-1", name: "Editors" }],
      nextCursor: null,
    });
    expect(get).toHaveBeenCalledWith(
      "/pages/templates/policies/spaces/space-1/groups",
      { params: { query: "edit", cursor: "next", limit: 50 } },
    );
  });

  it("archives and restores through explicit catalog actions", async () => {
    post
      .mockResolvedValueOnce({ data: { archiveState: "archived" } } as any)
      .mockResolvedValueOnce({ data: { archiveState: "active" } } as any);

    await archivePageTemplate("template-1");
    await restorePageTemplate("template-1");

    expect(post).toHaveBeenNthCalledWith(
      1,
      "/pages/templates/template-1/actions/archive",
    );
    expect(post).toHaveBeenNthCalledWith(
      2,
      "/pages/templates/template-1/actions/restore",
    );
  });

  it("creates independent copies with a retry-safe idempotency key", async () => {
    post.mockResolvedValue({
      data: { page: { id: "copy-1" }, idempotent: false },
    } as any);

    await expect(
      createIndependentPageCopy({ pageId: "linked-1" }),
    ).resolves.toEqual({
      page: { id: "copy-1" },
      idempotent: false,
    });

    expect(post).toHaveBeenCalledWith(
      "/pages/linked-1/actions/create-independent-copy",
      { title: undefined, parentPageId: undefined },
      { headers: { "Idempotency-Key": expect.any(String) } },
    );
  });

  it("does not send inherited policy gates in a space policy update", async () => {
    put.mockResolvedValue({ data: { revision: 5 } } as any);

    await updatePageTemplateSpacePolicy(
      {
        spaceId: "space-1",
        systemEnabled: true,
        workspaceEnabled: false,
        templatesEnabled: true,
        allowCreateTemplate: true,
        allowRegularTemplate: true,
        allowSyncedTemplate: false,
        revision: 4,
      },
      { allowSyncedTemplate: true },
    );

    expect(put).toHaveBeenCalledWith(
      "/pages/templates/policies/spaces/space-1",
      {
        templatesEnabled: true,
        allowCreateTemplate: true,
        allowRegularTemplate: true,
        allowSyncedTemplate: true,
        expectedRevision: 4,
      },
    );
  });

  it("requests a publication preflight from the live collaboration draft", async () => {
    post.mockResolvedValue({ data: { draftHash: "hash" } } as any);

    await preflightPageTemplatePublish("page-1");

    expect(post).toHaveBeenCalledWith(
      "/pages/templates/page-1/actions/preflight-publish",
    );
  });

  it("uses the same binary key order as the server content hash", async () => {
    await expect(
      hashProseMirrorJson({ type: "doc", a: 3, _meta: 2, A: 1 }),
    ).resolves.toBe(
      "6c58be2700954cd9d08e3601c25b522fede504bfb50a88dbed6d76024bf18a29",
    );
  });

  it("matches the server deterministic normalization for draft hashes", async () => {
    const draft = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Draft" }],
        },
      ],
    };
    const seed = await sha256Hex(serializeTemplateDraftSeed(draft));
    const generated = await sha256Hex(`${seed}:0`);
    const templateBlockId = formatTemplateDraftId(generated);
    const expected = await hashProseMirrorJson({
      type: "doc",
      content: [
        {
          type: "templateManagedBlock",
          attrs: { templateBlockId, locked: false },
          content: draft.content,
        },
      ],
    });

    await expect(hashNormalizedTemplateDraft(draft)).resolves.toBe(expected);
    await expect(hashNormalizedTemplateDraft(draft)).resolves.toBe(expected);
  });

  it("ignores client schema defaults that do not change template content", async () => {
    const serverDraft = {
      type: "doc",
      content: [
        {
          type: "templateManagedBlock",
          attrs: { templateBlockId: "block-a", locked: false },
          content: [
            {
              type: "paragraph",
              attrs: { id: "paragraph-a", indent: 0 },
              content: [{ type: "text", text: "Draft" }],
            },
          ],
        },
      ],
    };
    const editorDraft = structuredClone(serverDraft);
    Object.assign(editorDraft.content[0].content[0].attrs, {
      textAlign: null,
    });

    await expect(hashNormalizedTemplateDraft(editorDraft)).resolves.toBe(
      await hashNormalizedTemplateDraft(serverDraft),
    );
  });

  it("ignores local node ids when hashing linked instance content", async () => {
    const serverContent = {
      type: "doc",
      content: [
        {
          type: "templateManagedBlock",
          attrs: { templateBlockId: "block-a", locked: true },
          content: [
            {
              type: "paragraph",
              attrs: { indent: 0 },
              content: [{ type: "text", text: "Managed" }],
            },
          ],
        },
      ],
    };
    const editorContent: any = structuredClone(serverContent);
    editorContent.content[0].content[0].attrs = {
      indent: 0,
      id: "local-paragraph-id",
      textAlign: null,
    };

    await expect(hashTemplateInstanceContent(editorContent)).resolves.toBe(
      await hashTemplateInstanceContent(serverContent),
    );
  });
});

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
