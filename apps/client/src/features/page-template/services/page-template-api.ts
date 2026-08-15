import api from "@/lib/api-client";
import type {
  PageTemplateAction,
  PageTemplateGroupPolicy,
  PageTemplatePolicyGroupsQuery,
  PageTemplatePolicyGroupsResponse,
  PageTemplateSpacePolicy,
  PageTemplateWorkspacePolicy,
} from "@docmost/api-contract";
import type {
  PageTemplateCapabilities,
  PageTemplateArchiveState,
  PageTemplateDestinationPage,
  PageTemplateDestinationPurpose,
  PageTemplateDiscoveryItem,
  PageTemplateProvenance,
  PageTemplateRevisionPage,
  PageTemplateUsagePage,
  TemplateKind,
  TemplatePublishPreflight,
  TemplateRevision,
  TemplateSyncRun,
} from "../types/page-template.types";

export function isCollaborationUnavailable(error: unknown): boolean {
  const response = (
    error as {
      response?: {
        status?: number;
        data?: { code?: string; statusCode?: number };
      };
    }
  )?.response;
  return (
    response?.data?.code === "collaboration_unavailable" ||
    response?.status === 503 ||
    response?.data?.statusCode === 503
  );
}

export async function discoverPageTemplates(params: {
  query?: string;
  spaceId: string;
  cursor?: string;
  limit?: number;
  kind?: TemplateKind;
  includeArchived?: boolean;
  archiveState?: PageTemplateArchiveState;
}): Promise<{
  items: PageTemplateDiscoveryItem[];
  nextCursor: string | null;
  capabilities: PageTemplateCapabilities;
}> {
  const response = await api.get("/pages/templates", { params });
  return {
    ...response.data,
    capabilities: normalizeCapabilities(response.data.capabilities),
  };
}

export async function getPageTemplateCapabilities(
  spaceId: string,
): Promise<PageTemplateCapabilities> {
  const response = await api.get("/pages/templates/capabilities", {
    params: { spaceId },
  });
  return normalizeCapabilities(response.data.capabilities);
}

export async function createPageTemplate(params: {
  spaceId: string;
  title?: string;
  kind: TemplateKind;
  sourcePageId?: string;
}) {
  return postIdempotent("/pages/templates/actions/create", params);
}

export async function getPageTemplateProvenance(
  pageId: string,
): Promise<PageTemplateProvenance> {
  const response = await api.get(`/pages/templates/${pageId}/provenance`);
  return response.data;
}

export async function getPageTemplateDestinations(params: {
  spaceId: string;
  pageId?: string;
  query?: string;
  cursor?: string;
  limit?: number;
  purpose?: PageTemplateDestinationPurpose;
}): Promise<PageTemplateDestinationPage> {
  const response = await api.get("/pages/templates/destinations", { params });
  return { ...response.data, nextCursor: response.data.nextCursor ?? null };
}

export async function createPageFromTemplate(params: {
  templatePageId: string;
  spaceId: string;
  parentPageId?: string;
  title?: string;
}) {
  return postIdempotent("/pages/actions/create-from-template", params);
}

export async function createIndependentPageCopy(params: {
  pageId: string;
  title?: string;
  parentPageId?: string | null;
}) {
  return postIdempotent(
    `/pages/${params.pageId}/actions/create-independent-copy`,
    {
      title: params.title,
      parentPageId: params.parentPageId,
    },
  );
}

export async function preflightPageTemplatePublish(
  pageId: string,
): Promise<TemplatePublishPreflight> {
  const response = await api.post(
    `/pages/templates/${pageId}/actions/preflight-publish`,
  );
  return response.data;
}

export async function publishPageTemplate(params: {
  pageId: string;
  draftHash: string;
  confirmationToken?: string;
}): Promise<{
  revision: TemplateRevision;
  syncRun: TemplateSyncRun;
  idempotent?: boolean;
  noOp?: boolean;
}> {
  return postIdempotent(`/pages/templates/${params.pageId}/actions/publish`, {
    draftHash: params.draftHash,
    confirmationToken: params.confirmationToken,
  });
}

export async function getPageTemplateRevisions(
  pageId: string,
  cursor?: string,
  limit = 20,
): Promise<PageTemplateRevisionPage> {
  const response = await api.get(`/pages/templates/${pageId}/revisions`, {
    params: { cursor, limit },
  });
  return { ...response.data, nextCursor: response.data.nextCursor ?? null };
}

export async function getPageTemplateSyncRuns(
  pageId: string,
): Promise<{ items: TemplateSyncRun[] }> {
  const response = await api.get(`/pages/templates/${pageId}/sync-runs`);
  return response.data;
}

export async function retryPageTemplateSyncRun(pageId: string, runId: string) {
  const response = await api.post(
    `/pages/templates/${pageId}/sync-runs/${runId}/actions/retry`,
  );
  return response.data as { accepted: true; runId: string };
}

export async function archivePageTemplate(pageId: string) {
  const response = await api.post(`/pages/templates/${pageId}/actions/archive`);
  return response.data as { pageId: string; archived: true };
}

export async function restorePageTemplate(pageId: string) {
  const response = await api.post(`/pages/templates/${pageId}/actions/restore`);
  return response.data as {
    pageId: string;
    archived: false;
    archiveState: "active";
  };
}

export async function detachSyncedPageTemplate(params: {
  pageId: string;
  baseContentHash: string;
}) {
  return postIdempotent(`/pages/${params.pageId}/actions/detach-template`, {
    confirmed: true,
    baseContentHash: params.baseContentHash,
  });
}

export async function getPageTemplateUsages(
  pageId: string,
  cursor?: string,
  limit = 20,
): Promise<PageTemplateUsagePage> {
  const response = await api.get(`/pages/templates/${pageId}/actions/usages`, {
    params: { cursor, limit },
  });
  return { ...response.data, nextCursor: response.data.nextCursor ?? null };
}

export type {
  PageTemplateAction,
  PageTemplateGroupPolicy,
  PageTemplateSpacePolicy,
  PageTemplateWorkspacePolicy,
} from "@docmost/api-contract";

export async function getPageTemplateWorkspacePolicy() {
  const response = await api.get("/pages/templates/policies/workspace");
  return response.data as PageTemplateWorkspacePolicy;
}

export async function updatePageTemplateWorkspacePolicy(
  policy: PageTemplateWorkspacePolicy,
  enabled: boolean,
) {
  const response = await api.patch("/pages/templates/policies/workspace", {
    enabled,
    expectedRevision: policy.revision,
  });
  return response.data as PageTemplateWorkspacePolicy;
}

export async function getPageTemplateSpacePolicy(spaceId: string) {
  const response = await api.get(`/pages/templates/policies/spaces/${spaceId}`);
  return response.data as PageTemplateSpacePolicy;
}

export async function updatePageTemplateSpacePolicy(
  policy: PageTemplateSpacePolicy,
  patch: Partial<
    Pick<
      PageTemplateSpacePolicy,
      | "templatesEnabled"
      | "allowCreateTemplate"
      | "allowRegularTemplate"
      | "allowSyncedTemplate"
    >
  >,
) {
  const next = { ...policy, ...patch };
  const response = await api.put(
    `/pages/templates/policies/spaces/${policy.spaceId}`,
    {
      templatesEnabled: next.templatesEnabled,
      allowCreateTemplate: next.allowCreateTemplate,
      allowRegularTemplate: next.allowRegularTemplate,
      allowSyncedTemplate: next.allowSyncedTemplate,
      expectedRevision: policy.revision,
    },
  );
  return response.data as PageTemplateSpacePolicy;
}

export async function getPageTemplateGroupPolicy(
  spaceId: string,
  groupId: string,
) {
  const response = await api.get(
    `/pages/templates/policies/spaces/${spaceId}/groups/${groupId}`,
  );
  return response.data as PageTemplateGroupPolicy;
}

export async function getPageTemplatePolicyGroups(
  spaceId: string,
  params: PageTemplatePolicyGroupsQuery = {},
): Promise<PageTemplatePolicyGroupsResponse> {
  const response = await api.get(
    `/pages/templates/policies/spaces/${spaceId}/groups`,
    { params },
  );
  return { ...response.data, nextCursor: response.data.nextCursor ?? null };
}

export async function updatePageTemplateGroupPolicy(
  policy: PageTemplateGroupPolicy,
  allowedActions: PageTemplateAction[] | null,
) {
  const response = await api.put(
    `/pages/templates/policies/spaces/${policy.spaceId}/groups/${policy.groupId}`,
    { allowedActions, expectedRevision: policy.revision },
  );
  return response.data as PageTemplateGroupPolicy;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

const inFlightIdempotencyKeys = new Map<string, string>();

function normalizeCapabilities(
  value: Partial<PageTemplateCapabilities> | undefined,
): PageTemplateCapabilities {
  return {
    enabled: Boolean(value?.enabled),
    createTemplate: Boolean(value?.createTemplate),
    manageTemplate: Boolean(value?.manageTemplate),
    useRegular: Boolean(value?.useRegular),
    useSynced: Boolean(value?.useSynced),
  };
}

async function postIdempotent(endpoint: string, body: unknown) {
  const fingerprint = `${endpoint}:${canonicalJson(body)}`;
  const storageKey = `docmost:idempotency:${fingerprint}`;
  let idempotencyKey = inFlightIdempotencyKeys.get(fingerprint);
  if (!idempotencyKey && typeof sessionStorage !== "undefined") {
    idempotencyKey = sessionStorage.getItem(storageKey) ?? undefined;
  }
  idempotencyKey ??= crypto.randomUUID();
  inFlightIdempotencyKeys.set(fingerprint, idempotencyKey);
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(storageKey, idempotencyKey);
  }
  const response = await api.post(endpoint, body, {
    headers: { "Idempotency-Key": idempotencyKey },
  });
  inFlightIdempotencyKeys.delete(fingerprint);
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(storageKey);
  }
  return response.data;
}
