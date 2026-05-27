import api from "@/lib/api-client";
import { IPagination, QueryParams } from "@/lib/types";
import { FavoriteType, IFavorite } from "@/features/favorite/types/favorite.types";

type FavoriteIdsResponse = {
  items: string[];
  meta: IPagination<string>["meta"];
};

function unwrap<T>(value: unknown): T {
  const response = value as { data?: T } & T;
  return response.data ?? response;
}

export async function getFavorites(
  params?: QueryParams & { type?: FavoriteType; spaceId?: string },
): Promise<IPagination<IFavorite>> {
  const req = await api.post<IPagination<IFavorite>>("/favorites", params);
  return unwrap<IPagination<IFavorite>>(req);
}

export async function getFavoriteIds(data: {
  type: FavoriteType;
  spaceId?: string;
}): Promise<FavoriteIdsResponse> {
  const req = await api.post<FavoriteIdsResponse>("/favorites/ids", data);
  return unwrap<FavoriteIdsResponse>(req);
}

export async function addFavorite(data: {
  type: FavoriteType;
  pageId?: string;
  spaceId?: string;
}): Promise<void> {
  await api.post("/favorites/add", data);
}

export async function removeFavorite(data: {
  type: FavoriteType;
  pageId?: string;
  spaceId?: string;
}): Promise<void> {
  await api.post("/favorites/remove", data);
}
