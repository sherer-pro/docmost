import {
  InfiniteData,
  useMutation,
  useInfiniteQuery,
  UseMutationResult,
  UseInfiniteQueryResult,
  useQuery,
  UseQueryResult,
} from "@tanstack/react-query";
import {
  getPageHistoryById,
  getPageHistoryList,
  deletePageHistory,
} from "@/features/page-history/services/page-history-service";
import { IPageHistory } from "@/features/page-history/types/page.types";
import { IPagination } from "@/lib/types.ts";
import { queryClient } from "@/lib/query-client";

const HISTORY_STALE_TIME = 60 * 60 * 1000;

export function prefetchPageHistory(historyId: string) {
  return queryClient.prefetchQuery({
    queryKey: ["page-history", historyId],
    queryFn: () => getPageHistoryById(historyId),
    staleTime: HISTORY_STALE_TIME,
  });
}

export async function invalidateDeletedPageHistory(
  pageId: string,
  historyId: string,
): Promise<void> {
  queryClient.removeQueries({
    queryKey: ["page-history", historyId],
  });
  await queryClient.invalidateQueries({
    queryKey: ["page-history-list", pageId],
  });
}

export function usePageHistoryListQuery(
  pageId: string,
): UseInfiniteQueryResult<InfiniteData<IPagination<IPageHistory>, unknown>> {
  return useInfiniteQuery({
    queryKey: ["page-history-list", pageId],
    queryFn: ({ pageParam }) => getPageHistoryList(pageId, pageParam),
    enabled: !!pageId,
    gcTime: 0,
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.meta?.nextCursor ?? undefined,
  });
}

export function usePageHistoryQuery(
  historyId: string,
): UseQueryResult<IPageHistory, Error> {
  return useQuery({
    queryKey: ["page-history", historyId],
    queryFn: () => getPageHistoryById(historyId),
    enabled: !!historyId,
    staleTime: HISTORY_STALE_TIME,
  });
}

export function useDeletePageHistoryMutation(
  pageId: string,
): UseMutationResult<void, Error, string> {
  return useMutation({
    mutationFn: deletePageHistory,
    onSuccess: async (_, historyId) => {
      await invalidateDeletedPageHistory(pageId, historyId);
    },
  });
}
