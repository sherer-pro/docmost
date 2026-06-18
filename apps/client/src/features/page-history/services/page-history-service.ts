import api from "@/lib/api-client";
import { IPageHistory } from "@/features/page-history/types/page.types";
import { IPagination } from "@/lib/types.ts";

export async function getPageHistoryList(
  pageId: string,
  cursor?: string,
): Promise<IPagination<IPageHistory>> {
  const req = await api.get("/pages/history", {
    params: { pageId, cursor },
  });
  return req.data;
}

export async function getPageHistoryById(
  historyId: string,
): Promise<IPageHistory> {
  const req = await api.get<IPageHistory>("/pages/history/info", {
    params: { historyId },
  });
  return req.data;
}
