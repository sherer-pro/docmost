import api from "@/lib/api-client";
import {
  IAttachmentSearch,
  IPageSearch,
  IPageSearchParams,
  IPageSearchLabel,
  ISuggestionResult,
  SearchLabelParams,
  SearchSuggestionParams,
} from '@/features/search/types/search.types';
import { IPagination } from "@/lib/types";

export async function searchPage(
  params: IPageSearchParams,
): Promise<IPageSearch[]> {
  const req = await api.post<{ items: IPageSearch[] }>("/search", params);
  return req.data.items;
}

export async function searchSuggestions(
  params: SearchSuggestionParams,
): Promise<ISuggestionResult> {
  const req = await api.get<ISuggestionResult>("/search/suggest", { params });
  return req.data;
}

export async function searchShare(
  params: IPageSearchParams,
): Promise<IPageSearch[]> {
  const req = await api.post<{ items: IPageSearch[] }>("/search/share-search", params);
  return req.data.items;
}

export async function searchAttachments(
  params: IPageSearchParams,
): Promise<IAttachmentSearch[]> {
  const req = await api.post<{ items: IAttachmentSearch[] }>("/search/attachments", params);
  return req.data.items;
}

export async function searchLabels(
  params: SearchLabelParams,
): Promise<IPageSearchLabel[]> {
  const req = await api.post<IPagination<IPageSearchLabel>>("/labels", {
    type: "page",
    limit: params.limit ?? 25,
    query: params.query,
  });
  return req.data.items;
}
