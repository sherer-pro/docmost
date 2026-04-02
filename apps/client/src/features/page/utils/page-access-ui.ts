import { SidebarNodeType } from "@/features/page/types/page.types";

/**
 * Returns whether the node can be configured via page-scoped access controls.
 */
export function supportsPageAccessEntity(
  nodeType?: SidebarNodeType | null,
): boolean {
  return (
    nodeType === "page" ||
    nodeType === "database" ||
    nodeType === "databaseRow"
  );
}

/**
 * Guards access modal opening by requiring a valid page id and permissions.
 */
export function canOpenPageAccessModal(input: {
  pageId?: string | null;
  canManageAccess?: boolean | null;
}): boolean {
  return Boolean(input.pageId && input.canManageAccess);
}

/**
 * Prevents click events inside access modal from reaching parent page links.
 */
export function stopPageAccessModalEvent(event: {
  stopPropagation: () => void;
}): void {
  event.stopPropagation();
}
