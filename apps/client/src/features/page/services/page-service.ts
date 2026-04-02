import api from "@/lib/api-client";
import {
  ICopyPageToSpace,
  IExportPageParams,
  IMovePage,
  IMovePageToSpace,
  IPage,
  IPageInput,
  IUpdatePageInput,
  ISidebarNode,
  SidebarPagesParams,
  PageAccessUserEntry,
  PageAccessGroupRuleEntry,
  PageAccessResolvedUser,
} from "@/features/page/types/page.types";
import { QueryParams } from "@/lib/types";
import { IPagination } from "@/lib/types.ts";
import { InfiniteData } from "@tanstack/react-query";
import { IFileTask } from '@/features/file-task/types/file-task.types.ts';
import { IAttachment } from '@/features/attachments/types/attachment.types.ts';
import { downloadBlobFromAxiosResponse } from '@/lib/download';

/**
 * Makes the page's `settings` look client-side compatible.
 *
 * Old API responses might return `settings: null`, and some of the responses would be
 * do not return the field at all. For the frontend it should look like
 * `settings === undefined` so that fallback on user preference works.
 */
function normalizePage<T extends IPage>(page: T): T {
  if (!page || typeof page !== 'object') {
    return page;
  }

  const rawSettings = (page as { settings?: unknown }).settings;
  if (rawSettings && typeof rawSettings === 'object') {
    return page;
  }

  return {
    ...page,
    settings: undefined,
  };
}

export async function createPage(data: Partial<IPage>): Promise<IPage> {
  const req = await api.post<IPage>("/pages/create", data);
  return req.data;
}

export async function getPageById(
  pageInput: Partial<IPageInput>,
): Promise<IPage> {
  const req = await api.post<IPage>("/pages/info", pageInput);
  return req.data;
}

export async function updatePage(data: IUpdatePageInput): Promise<IPage> {
  const req = await api.post<IPage>("/pages/update", data);
  return req.data;
}

export async function deletePage(
  pageId: string,
  permanentlyDelete = false,
): Promise<void> {
  await api.post("/pages/delete", { pageId, permanentlyDelete });
}

export async function getDeletedPages(
  spaceId: string,
  params?: QueryParams,
): Promise<IPagination<IPage>> {
  const req = await api.post("/pages/trash", { spaceId, ...params });
  return req.data;
}

export async function restorePage(pageId: string): Promise<IPage> {
  const response = await api.post<IPage>("/pages/restore", { pageId });
  return response.data;
}

export async function movePage(data: IMovePage): Promise<void> {
  await api.post<void>("/pages/move", data);
}

export async function movePageToSpace(data: IMovePageToSpace): Promise<void> {
  await api.post<void>("/pages/move-to-space", data);
}

export async function duplicatePage(data: ICopyPageToSpace): Promise<IPage> {
  const req = await api.post<IPage>("/pages/duplicate", data);
  return req.data;
}

export async function getSidebarPages(
  params: SidebarPagesParams,
): Promise<IPagination<ISidebarNode>> {
  const req = await api.post("/pages/sidebar-pages", params);
  return req.data;
}

export async function getAllSidebarPages(
  params: SidebarPagesParams,
): Promise<InfiniteData<IPagination<ISidebarNode>, unknown>> {
  let cursor: string | undefined = undefined;
  const pages: IPagination<ISidebarNode>[] = [];
  const pageParams: (string | undefined)[] = [];

  do {
    const req = await api.post("/pages/sidebar-pages", { ...params, cursor });

    const data: IPagination<ISidebarNode> = req.data;
    pages.push(data);
    pageParams.push(cursor);

    cursor = data.meta.nextCursor ?? undefined;
  } while (cursor);

  return {
    pageParams,
    pages,
  };
}

export async function getPageBreadcrumbs(
  pageId: string,
): Promise<Partial<IPage[]>> {
  const req = await api.post("/pages/breadcrumbs", { pageId });
  return req.data;
}

export async function getRecentChanges(
  spaceId?: string,
): Promise<IPagination<IPage>> {
  const req = await api.post("/pages/recent", { spaceId });
  return req.data;
}

export async function exportPage(data: IExportPageParams): Promise<void> {
  /**
   * Export returns a binary file with `content-disposition` header,
   * so we explicitly request a blob response and keep full AxiosResponse.
   */
  const req = await api.post('/pages/actions/export', data, {
    responseType: "blob",
    skipEnvelopeUnwrap: true,
  });

  downloadBlobFromAxiosResponse(req);
}

export async function importPage(file: File, spaceId: string) {
  const formData = new FormData();
  formData.append("spaceId", spaceId);
  formData.append("file", file);

  const req = await api.post<IPage>('/pages/actions/import', formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  return req.data;
}

export async function importZip(
  file: File,
  spaceId: string,
  source?: string,
): Promise<IFileTask> {
  const formData = new FormData();
  formData.append("spaceId", spaceId);
  formData.append("source", source);
  formData.append("file", file);

  const req = await api.post<any>('/pages/actions/import-zip', formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  return req.data;
}

export async function uploadFile(
  file: File,
  pageId: string,
  attachmentId?: string,
): Promise<IAttachment> {
  const formData = new FormData();
  if (attachmentId) {
    formData.append("attachmentId", attachmentId);
  }
  formData.append("pageId", pageId);
  formData.append("file", file);

  const req = await api.post<IAttachment>(
    "/attachments/actions/upload-file",
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    },
  );

  return req as unknown as IAttachment;
}

export interface QuoteContentInput {
  sourcePageId: string;
  quoteId: string;
}

export interface QuoteContentResult {
  text: string;
}

export async function getQuoteContent(
  data: QuoteContentInput,
): Promise<QuoteContentResult> {
  const req = await api.post<QuoteContentResult>("/pages/quote-content", data);
  return req.data;
}

export interface LinkPreviewResult {
  url: string;
  title: string;
  description: string;
  image: string | null;
  siteName: string;
}

export async function getLinkPreview(url: string): Promise<LinkPreviewResult> {
  const req = await api.post<LinkPreviewResult>("/pages/link-preview", { url });
  return req.data;
}

/**
 * DTO of the conversion result page -> database.
 */
export interface ConvertPageToDatabaseResult {
  databaseId: string;
  pageId: string;
}

/**
 * Converts a page to a database.
 */
export async function convertPageToDatabase(
  pageId: string,
): Promise<ConvertPageToDatabaseResult> {
  const req = await api.post<ConvertPageToDatabaseResult>(
    `/pages/${pageId}/convert-to-database`,
  );
  return req.data;
}

export async function getPageAccessUsers(
  pageId: string,
  params?: QueryParams,
): Promise<IPagination<PageAccessUserEntry>> {
  const req = await api.post(
    `/pages/${pageId}/actions/access/users`,
    params ?? {},
  );
  return req.data;
}

export async function getPageAccessGroups(
  pageId: string,
  params?: QueryParams,
): Promise<IPagination<PageAccessGroupRuleEntry>> {
  const req = await api.post(
    `/pages/${pageId}/actions/access/groups`,
    params ?? {},
  );
  return req.data;
}

export async function resolvePageAccessUsers(
  pageId: string,
  payload: { userIds: string[] },
): Promise<PageAccessResolvedUser[]> {
  const req = await api.post(
    `/pages/${pageId}/actions/access/resolve-users`,
    payload,
  );
  return req.data;
}

export async function grantPageUserAccess(
  pageId: string,
  payload: { userId: string; role: "reader" | "writer" },
): Promise<void> {
  await api.post(`/pages/${pageId}/actions/access/grant-user`, payload);
}

export async function closePageUserAccess(
  pageId: string,
  payload: { userId: string },
): Promise<void> {
  await api.post(`/pages/${pageId}/actions/access/close-user`, payload);
}

export async function grantPageGroupAccess(
  pageId: string,
  payload: { groupId: string; role: "reader" | "writer" },
): Promise<void> {
  await api.post(`/pages/${pageId}/actions/access/grant-group`, payload);
}

export async function closePageGroupAccess(
  pageId: string,
  payload: { groupId: string },
): Promise<void> {
  await api.post(`/pages/${pageId}/actions/access/close-group`, payload);
}

