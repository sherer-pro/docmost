import api from "@/lib/api-client";
import { IPagination, QueryParams } from "@/lib/types";
import { FavoriteType, IFavorite } from "@/features/favorite/types/favorite.types";

type FavoriteIdsResponse = {
  items: string[];
  meta: IPagination<string>["meta"];
};

export async function getFavorites(
  params?: QueryParams & { type?: FavoriteType; spaceId?: string },
): Promise<IPagination<IFavorite>> {
  const req = await api.get<IPagination<IFavorite>>("/favorites", {
    params,
  });
  return req.data;
}

export async function getFavoriteIds(data: {
  type: FavoriteType;
  spaceId?: string;
}): Promise<FavoriteIdsResponse> {
  const req = await api.get<FavoriteIdsResponse>("/favorites/ids", {
    params: data,
  });
  return req.data;
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
