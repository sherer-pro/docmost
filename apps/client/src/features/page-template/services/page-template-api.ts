import api from "@/lib/api-client";
import type {
  PageTemplateCapabilities,
  PageTemplateDestination,
  PageTemplateDiscoveryItem,
  PageTemplateProvenance,
  TemplateKind,
  TemplatePublishPreflight,
  TemplateRevision,
  TemplateSyncRun,
} from "../types/page-template.types";

export async function discoverPageTemplates(params: {
  query?: string;
  spaceId: string;
  cursor?: string;
  limit?: number;
  kind?: TemplateKind;
  includeArchived?: boolean;
}): Promise<{
  items: PageTemplateDiscoveryItem[];
  nextCursor: string | null;
  capabilities: PageTemplateCapabilities;
}> {
  const response = await api.get("/pages/templates", { params });
  return response.data;
}

export async function createPageTemplate(params: {
  spaceId: string;
  title?: string;
  kind: TemplateKind;
  sourcePageId?: string;
}) {
  const response = await api.post("/pages/templates/actions/create", params);
  return response.data;
}

export async function getPageTemplateProvenance(
  pageId: string,
): Promise<PageTemplateProvenance> {
  const response = await api.get(`/pages/templates/${pageId}/provenance`);
  return response.data;
}

export async function getPageTemplateDestinations(params: {
  spaceId: string;
  query?: string;
  limit?: number;
}): Promise<{ rootAllowed: boolean; items: PageTemplateDestination[] }> {
  const response = await api.get("/pages/templates/destinations", { params });
  return response.data;
}

export async function createPageFromTemplate(params: {
  templatePageId: string;
  spaceId: string;
  parentPageId?: string;
  title?: string;
}) {
  return postIdempotent("/pages/actions/create-from-template", params);
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
}): Promise<{ revision: TemplateRevision; syncRun: TemplateSyncRun }> {
  const response = await api.post(
    `/pages/templates/${params.pageId}/actions/publish`,
    {
      draftHash: params.draftHash,
      confirmationToken: params.confirmationToken,
    },
  );
  return response.data;
}

export async function getPageTemplateRevisions(
  pageId: string,
): Promise<{ items: Array<TemplateRevision & { content: unknown }> }> {
  const response = await api.get(`/pages/templates/${pageId}/revisions`);
  return response.data;
}

export async function getPageTemplateSyncRuns(
  pageId: string,
): Promise<{ items: TemplateSyncRun[] }> {
  const response = await api.get(`/pages/templates/${pageId}/sync-runs`);
  return response.data;
}

export async function retryPageTemplateSyncRun(
  pageId: string,
  runId: string,
) {
  const response = await api.post(
    `/pages/templates/${pageId}/sync-runs/${runId}/actions/retry`,
  );
  return response.data as { accepted: true; runId: string };
}

export async function archivePageTemplate(pageId: string) {
  const response = await api.post(
    `/pages/templates/${pageId}/actions/archive`,
  );
  return response.data as { pageId: string; archived: true };
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

export async function getPageTemplateUsages(pageId: string) {
  const response = await api.get(
    `/pages/templates/${pageId}/actions/usages`,
  );
  return response.data as {
    totalCount: number;
    hiddenCount: number;
    items: Array<{
      childPageId: string;
      slugId: string;
      title: string | null;
      icon: string | null;
      status: string;
      appliedRevision: number | null;
      updatedAt: string;
    }>;
  };
}

export type PageTemplateWorkspacePolicy = {
  enabled: boolean;
  revision: number;
  systemEnabled: boolean;
};

export type PageTemplateSpacePolicy = {
  spaceId: string;
  templatesEnabled: boolean;
  allowCreateTemplate: boolean;
  allowRegularTemplate: boolean;
  allowSyncedTemplate: boolean;
  revision: number;
};

export type PageTemplateAction =
  | "create_template"
  | "manage_template"
  | "use_regular_template"
  | "use_synced_template";

export type PageTemplateGroupPolicy = {
  groupId: string;
  spaceId: string;
  allowedActions: PageTemplateAction[] | null;
  revision: number;
};

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
  patch: Partial<Omit<PageTemplateSpacePolicy, "spaceId" | "revision">>,
) {
  const response = await api.put(
    `/pages/templates/policies/spaces/${policy.spaceId}`,
    {
      ...policy,
      ...patch,
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

export async function hashProseMirrorJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
