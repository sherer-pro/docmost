import type {
  PageTemplateCatalogItem,
  PageTemplateDestinationsResponse,
  PageTemplateRevisionsResponse,
  PageTemplateUsagesResponse,
} from "@docmost/api-contract";

export type {
  PageTemplateArchiveState,
  PageTemplateCapabilities,
  PageTemplateDestination,
  PageTemplateDestinationPurpose,
  PageTemplateProvenance,
  PageTemplateUsage,
  TemplateDraftDiff,
  TemplateInstanceInfo,
  TemplateInstanceStatus,
  TemplateKind,
  TemplatePublishPreflight,
  TemplateRevision,
  TemplateSyncRun,
  TemplateSyncRunStatus,
} from "@docmost/api-contract";

export type PageTemplateDiscoveryItem = PageTemplateCatalogItem;
export type PageTemplateDestinationPage = PageTemplateDestinationsResponse;
export type PageTemplateUsagePage = PageTemplateUsagesResponse;
export type PageTemplateRevisionPage = PageTemplateRevisionsResponse;
