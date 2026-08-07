export const TEMPLATE_KINDS = ["regular", "synced"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const TEMPLATE_INSTANCE_STATUSES = [
  "snapshot",
  "active",
  "syncing",
  "error",
  "detached",
] as const;
export type TemplateInstanceStatus =
  (typeof TEMPLATE_INSTANCE_STATUSES)[number];

export const TEMPLATE_SYNC_RUN_STATUSES = [
  "pending",
  "running",
  "completed",
  "partial",
  "failed",
] as const;
export type TemplateSyncRunStatus =
  (typeof TEMPLATE_SYNC_RUN_STATUSES)[number];

export type TemplateFieldSummary = {
  fieldId: string;
  label: string;
  placeholder: string;
};

export type TemplateRevision = {
  id: string;
  templatePageId: string;
  revision: number;
  contentHash: string;
  publishedById: string | null;
  createdAt: string;
};

export type TemplateDraftDiff = {
  addedBlockIds: string[];
  removedBlockIds: string[];
  movedBlockIds: string[];
  changedBlockIds: string[];
  addedFields: TemplateFieldSummary[];
  removedFields: TemplateFieldSummary[];
  renamedFields: Array<{
    fieldId: string;
    previousLabel: string;
    nextLabel: string;
  }>;
};

export type TemplatePublishPreflight = {
  draftHash: string;
  nextRevision: number;
  diff: TemplateDraftDiff;
  activeInstanceCount: number;
  filledRemovedFieldInstanceCount: number;
  requiresDestructiveConfirmation: boolean;
  confirmationToken: string | null;
  confirmationExpiresAt: string | null;
};

export type TemplateSyncRun = {
  id: string;
  templatePageId: string;
  revision: number;
  status: TemplateSyncRunStatus;
  totalCount: number;
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  errorCode: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type TemplateInstanceInfo = {
  kind: TemplateKind;
  status: TemplateInstanceStatus;
  appliedRevision: number | null;
  latestRevision: number | null;
  sourceTemplate: {
    id: string;
    slugId: string;
    title: string | null;
    icon: string | null;
    spaceSlug: string | null;
  } | null;
  canReadTemplate: boolean;
  canDetach: boolean;
};

export type PageTemplateCatalogItem = {
  id: string;
  slugId: string;
  title: string | null;
  icon: string | null;
  spaceId: string;
  spaceName: string;
  spaceSlug: string;
  kind: TemplateKind;
  updatedAt: string;
  archivedAt: string | null;
  favorite: boolean;
  recent: boolean;
  publishedRevision: number | null;
  draftChanged: boolean;
  activeInstanceCount: number;
  failedInstanceCount: number;
  actions: { use: boolean; manage: boolean };
};
