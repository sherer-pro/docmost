export const TEMPLATE_KINDS = ["regular", "synced"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const PAGE_TEMPLATE_ARCHIVE_STATES = ["active", "archived"] as const;
export type PageTemplateArchiveState =
  (typeof PAGE_TEMPLATE_ARCHIVE_STATES)[number];

export const PAGE_TEMPLATE_ACTIONS = [
  "create_template",
  "manage_template",
  "use_regular_template",
  "use_synced_template",
] as const;
export type PageTemplateAction = (typeof PAGE_TEMPLATE_ACTIONS)[number];

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
export type TemplateSyncRunStatus = (typeof TEMPLATE_SYNC_RUN_STATUSES)[number];

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
  content?: unknown;
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
  filledRemovedFieldInstanceCountExact: boolean;
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

export const PAGE_TEMPLATE_PROVENANCE_STATES = [
  "linked",
  "restricted",
  "source_missing",
  "invalid",
] as const;
export type PageTemplateProvenanceState =
  (typeof PAGE_TEMPLATE_PROVENANCE_STATES)[number];

export type PageTemplateSourceSummary = {
  id: string;
  slugId: string;
  title: string | null;
  icon: string | null;
  spaceSlug: string | null;
};

type TemplateInstanceInfoBase = {
  kind: TemplateKind;
  status: TemplateInstanceStatus;
  appliedRevision: number | null;
  latestRevision: number | null;
  canDetach: boolean;
  canCreateIndependentCopy: boolean;
  lastErrorCode: string | null;
};

export type TemplateInstanceInfo = TemplateInstanceInfoBase &
  (
    | {
        provenanceState: "linked";
        sourceTemplate: PageTemplateSourceSummary;
        canReadTemplate: true;
      }
    | {
        provenanceState: Exclude<
          PageTemplateProvenanceState,
          "linked"
        >;
        sourceTemplate: null;
        canReadTemplate: false;
      }
  );

export type PageTemplateProvenance =
  | {
      createdFromTemplate: false;
      sourceTemplate: null;
    }
  | ({ createdFromTemplate: true } & TemplateInstanceInfo);

export type PageTemplateCapabilities = {
  enabled: boolean;
  createTemplate: boolean;
  manageTemplate: boolean;
  useRegular: boolean;
  useSynced: boolean;
};

export type PageTemplateCatalogActions = {
  use: boolean;
  manage: boolean;
  archive: boolean;
  restore: boolean;
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
  archiveState: PageTemplateArchiveState;
  favorite: boolean;
  recent: boolean;
  publishedRevision: number | null;
  draftChanged: boolean;
  usageCount: number;
  activeInstanceCount: number;
  failedInstanceCount: number;
  actions: PageTemplateCatalogActions;
};

export type PageTemplateDestination = {
  id: string;
  slugId: string;
  title: string | null;
  icon: string | null;
  parentPageId: string | null;
};

export const PAGE_TEMPLATE_DESTINATION_PURPOSES = [
  "destination",
  "source",
] as const;
export type PageTemplateDestinationPurpose =
  (typeof PAGE_TEMPLATE_DESTINATION_PURPOSES)[number];

export type PageTemplateUsage = {
  childPageId: string;
  slugId: string;
  title: string | null;
  icon: string | null;
  status: TemplateInstanceStatus;
  appliedRevision: number | null;
  lastErrorCode: string | null;
  updatedAt: string;
};

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export type PageTemplateCapabilitiesResponse = {
  capabilities: PageTemplateCapabilities;
};

export type PageTemplateDiscoveryResponse =
  CursorPage<PageTemplateCatalogItem> & PageTemplateCapabilitiesResponse;

export type PageTemplateDestinationsResponse =
  CursorPage<PageTemplateDestination> & {
    rootAllowed: boolean;
  };

export type PageTemplateUsagesResponse = CursorPage<PageTemplateUsage> & {
  totalCount: number;
  hiddenCount: number;
};

export type PageTemplateRevisionsResponse = CursorPage<TemplateRevision>;

export type PageTemplateSyncRunsResponse = {
  items: TemplateSyncRun[];
};

export type PageTemplateWorkspacePolicy = {
  enabled: boolean;
  revision: number;
  systemEnabled: boolean;
};

export type PageTemplateSpacePolicy = {
  spaceId: string;
  systemEnabled: boolean;
  workspaceEnabled: boolean;
  templatesEnabled: boolean;
  allowCreateTemplate: boolean;
  allowRegularTemplate: boolean;
  allowSyncedTemplate: boolean;
  revision: number;
};

export type PageTemplateGroupPolicy = {
  groupId: string;
  spaceId: string;
  allowedActions: PageTemplateAction[] | null;
  revision: number;
};

export type PageTemplatePolicyGroup = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  memberCount: number;
};

export type PageTemplatePolicyGroupsQuery = {
  query?: string;
  cursor?: string;
  limit?: number;
};

export type PageTemplatePolicyGroupsResponse =
  CursorPage<PageTemplatePolicyGroup>;

export type PageTemplateArchiveResponse = {
  pageId: string;
  archived: boolean;
  archiveState: PageTemplateArchiveState;
};

export type CreatePageTemplateResponse<TPage = unknown> = {
  page: TPage;
  idempotent: boolean;
};

export type CreateIndependentPageCopyResponse<TPage = unknown> = {
  page: TPage;
  idempotent: boolean;
};

export type PublishPageTemplateResponse = {
  revision: TemplateRevision;
  syncRun: TemplateSyncRun;
  idempotent: boolean;
  noOp: boolean;
};
