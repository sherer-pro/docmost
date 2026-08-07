export type {
  PageTemplateCatalogItem as PageTemplateDiscoveryItem,
  TemplateDraftDiff,
  TemplateInstanceInfo,
  TemplateInstanceStatus,
  TemplateKind,
  TemplatePublishPreflight,
  TemplateRevision,
  TemplateSyncRun,
  TemplateSyncRunStatus,
} from "@docmost/api-contract";

export type PageTemplateCapabilities = {
  enabled: boolean;
  createTemplate: boolean;
  useRegular: boolean;
  useSynced: boolean;
};

export type PageTemplateDestination = {
  id: string;
  slugId: string;
  title: string | null;
  icon: string | null;
  parentPageId: string | null;
};

export type PageTemplateProvenance = {
  createdFromTemplate: boolean;
  kind?: "regular" | "synced";
  status?: "snapshot" | "active" | "syncing" | "error" | "detached";
  appliedRevision?: number | null;
  latestRevision?: number | null;
  canReadTemplate?: boolean;
  canDetach?: boolean;
  sourceTemplate: {
    id: string;
    slugId: string;
    title: string | null;
    icon: string | null;
    spaceSlug: string | null;
  } | null;
};
