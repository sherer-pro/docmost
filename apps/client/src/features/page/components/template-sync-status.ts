import type { TemplateSyncRunStatus } from "@/features/page-template/types/page-template.types";

type Translate = (key: string, values?: Record<string, unknown>) => string;

export function isTemplateSyncRunNonTerminal(
  status?: TemplateSyncRunStatus,
): boolean {
  return status === "pending" || status === "running";
}

export function getTemplateSyncRunLabel(
  status: TemplateSyncRunStatus,
  t: Translate,
): string {
  switch (status) {
    case "pending":
      return t("Queued");
    case "running":
      return t("Updating");
    case "completed":
      return t("Up to date");
    case "partial":
      return t("Partially updated");
    case "failed":
      return t("Update failed");
  }
}

export function getTemplateSyncErrorLabel(
  errorCode: string | null | undefined,
  t: Translate,
): string {
  switch (errorCode) {
    case "page_template_child_missing":
      return t("A linked page is no longer available.");
    case "page_template_source_missing":
      return t("The source template is no longer available.");
    case "page_template_attachment_unavailable":
      return t("A template attachment could not be copied.");
    case "page_template_revision_stale":
      return t("A newer template version is already available.");
    case "page_embed_stale":
      return t("A linked page changed before the update completed.");
    case "page_template_sync_partial_failure":
      return t("Some linked pages could not be updated.");
    case "page_template_operation_failed":
    default:
      return t("Synchronization could not be completed.");
  }
}
