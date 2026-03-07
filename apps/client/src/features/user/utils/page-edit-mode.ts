import { PageEditMode } from "@/features/user/types/user.types.ts";

/**
 * Normalize persisted/edit-mode values so UI keeps working
 * even if legacy payloads include casing/quote inconsistencies.
 */
export function normalizePageEditMode(value?: string | null): PageEditMode {
  const normalized = value?.toLowerCase()?.trim().replace(/^"+|"+$/g, "");
  return normalized === PageEditMode.Read
    ? PageEditMode.Read
    : PageEditMode.Edit;
}
