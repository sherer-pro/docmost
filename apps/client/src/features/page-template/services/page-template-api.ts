import api from "@/lib/api-client";
import type {
  PageEmbedLookup,
  PageTemplateCapabilities,
  PageTemplateDestination,
  PageTemplateDiscoveryItem,
} from "../types/page-template.types";

export async function lookupPageEmbeds(params: {
  sourcePageIds: string[];
  referencePageId?: string;
  shareId?: string;
}): Promise<{ items: PageEmbedLookup[]; maxDepth: number }> {
  const body = {
    ...(params.shareId ? { shareId: params.shareId } : {}),
    ...(params.referencePageId
      ? { referencePageId: params.referencePageId }
      : {}),
    references: params.sourcePageIds.map((sourcePageId) => ({
      kind: "page" as const,
      sourcePageId,
    })),
  };
  const response = await api.post(
    params.shareId
      ? "/shares/transclusion/lookup"
      : "/pages/transclusion/lookup",
    body,
  );
  return response.data;
}

export async function discoverPageTemplates(params: {
  query?: string;
  spaceId: string;
  cursor?: string;
  limit?: number;
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
}) {
  const response = await api.post("/pages/templates/actions/create", params);
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

export async function setPageTemplate(pageId: string, enabled: boolean) {
  const response = await api.post(`/pages/${pageId}/actions/set-template`, {
    enabled,
  });
  return response.data as { pageId: string; isTemplate: boolean };
}

export async function createPageFromTemplate(params: {
  templatePageId: string;
  spaceId: string;
  parentPageId?: string;
  title?: string;
}) {
  return postIdempotent("/pages/actions/create-from-template", params);
}

export async function insertPageEmbed(params: {
  consumerPageId: string;
  sourcePageId: string;
  from: number;
  to: number;
  baseContentHash: string;
}) {
  return postIdempotent(
    "/pages/transclusion/actions/insert-page-embed",
    params,
  );
}

export async function detachPageEmbed(params: {
  consumerPageId: string;
  referenceNodeId: string;
  baseContentHash: string;
}) {
  return postIdempotent(
    "/pages/transclusion/actions/detach-page-embed",
    params,
  );
}

export type PageTemplateWorkspacePolicy = {
  enabled: boolean;
  revision: number;
  systemEnabled: boolean;
  maxPageEmbedDepth: number;
};

export type PageTemplateSpacePolicy = {
  spaceId: string;
  templatesEnabled: boolean;
  allowCreateTemplate: boolean;
  allowSnapshot: boolean;
  allowLiveEmbed: boolean;
  allowPublicLiveEmbed: boolean;
  revision: number;
};

export type PageTemplateAction =
  | "create_template"
  | "manage_template"
  | "use_snapshot"
  | "use_live_embed";

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
    .sort(([left], [right]) => left.localeCompare(right))
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
