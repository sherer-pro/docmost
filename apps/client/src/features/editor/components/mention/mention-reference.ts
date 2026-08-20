import type { PageReference } from "@docmost/api-contract";

export function resolvePageMentionReference(
  stored: {
    slugId?: string | null;
    label?: string | null;
    icon?: string | null;
  },
  reference?: PageReference,
) {
  return {
    slugId: reference?.slugId || stored.slugId || "",
    title: reference?.title || stored.label || "",
    icon: reference?.icon || stored.icon || null,
  };
}
