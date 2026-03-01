/**
 * Shared status-to-color map for all status indicators in the client.
 *
 * Colors are aligned with the existing page tree visuals so that the same
 * status always has the same appearance across different UI sections.
 */
export const STATUS_COLOR_MAP: Record<string, string> = {
  TODO: "var(--mantine-color-gray-6)",
  IN_PROGRESS: "var(--mantine-color-blue-6)",
  IN_REVIEW: "var(--mantine-color-indigo-6)",
  DONE: "var(--mantine-color-green-6)",
  REJECTED: "var(--mantine-color-red-6)",
  ARCHIVED: "var(--mantine-color-dark-4)",
};
