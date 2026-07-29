import type { AiActivityItem } from "@/features/ai/types/ai.types.ts";

export function isAiActivityActive(item: AiActivityItem): boolean {
  return item.status === "queued" || item.status === "running";
}

export function getVisibleAiActivities(
  activities: Record<string, AiActivityItem>,
): AiActivityItem[] {
  return Object.values(activities)
    .filter((item) => isAiActivityActive(item) || item.unread)
    .sort((left, right) => {
      const activeDifference =
        Number(isAiActivityActive(right)) - Number(isAiActivityActive(left));
      return (
        activeDifference ||
        new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime()
      );
    });
}

export function clearAiPageActivity(
  activities: Record<string, AiActivityItem>,
  pageId: string,
): Record<string, AiActivityItem> {
  return Object.fromEntries(
    Object.entries(activities).filter(
      ([, item]) => item.pageId !== pageId || isAiActivityActive(item),
    ),
  );
}
