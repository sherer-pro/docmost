import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addFavorite,
  getFavoriteIds,
  getFavorites,
  removeFavorite,
} from "@/features/favorite/services/favorite-service";
import { FavoriteType } from "@/features/favorite/types/favorite.types";

export const FAVORITE_QUERY_KEYS = {
  all: ["favorites"] as const,
  list: (type?: FavoriteType, spaceId?: string) =>
    ["favorites", "list", type ?? "all", spaceId ?? "all"] as const,
  ids: (type: FavoriteType, spaceId?: string) =>
    ["favorites", "ids", type, spaceId ?? "all"] as const,
};

export function useFavoritesQuery(opts?: {
  type?: FavoriteType;
  spaceId?: string;
}) {
  return useQuery({
    queryKey: FAVORITE_QUERY_KEYS.list(opts?.type, opts?.spaceId),
    queryFn: () => getFavorites({ type: opts?.type, spaceId: opts?.spaceId }),
  });
}

export function useFavoriteIdsQuery(type: FavoriteType, spaceId?: string) {
  return useQuery({
    queryKey: FAVORITE_QUERY_KEYS.ids(type, spaceId),
    queryFn: () => getFavoriteIds({ type, spaceId }),
  });
}

export function useToggleFavoriteMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      type: FavoriteType;
      id: string;
      isFavorite: boolean;
      spaceId?: string;
    }) => {
      const payload =
        data.type === "page"
          ? { type: data.type, pageId: data.id }
          : { type: data.type, spaceId: data.id };

      if (data.isFavorite) {
        await removeFavorite(payload);
      } else {
        await addFavorite(payload);
      }
    },
    onSuccess: (_result, data) => {
      queryClient.invalidateQueries({ queryKey: FAVORITE_QUERY_KEYS.all });
      queryClient.invalidateQueries({
        queryKey: FAVORITE_QUERY_KEYS.ids(data.type, data.spaceId),
      });
    },
  });
}
