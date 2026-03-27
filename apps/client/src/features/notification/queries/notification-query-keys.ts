import { QueryClient } from "@tanstack/react-query";

export const NOTIFICATION_KEY = ["notifications"] as const;
export const UNREAD_COUNT_KEY = [...NOTIFICATION_KEY, "unread-count"] as const;

export async function invalidateNotificationQueries(
  queryClient: Pick<QueryClient, "invalidateQueries">,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: NOTIFICATION_KEY }),
    queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY }),
  ]);
}
