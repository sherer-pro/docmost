import api from "@/lib/api-client";
import {
  IAddSpaceMember,
  IChangeSpaceMemberRole,
  IExportSpaceParams,
  IRemoveSpaceMember,
  ISpace,
  ISpaceMember,
} from "@/features/space/types/space.types";
import { IPagination, QueryParams } from "@/lib/types.ts";
import { SpaceUserInfo } from "@/features/space/types/space.types.ts";
import { downloadBlobFromAxiosResponse } from '@/lib/download';
import type { SpacePolicyContext } from "@docmost/api-contract";

export async function getSpaces(
  params?: QueryParams,
): Promise<IPagination<ISpace>> {
  const req = await api.get('/spaces', { params });
  return req.data;
}

export async function getSpaceById(spaceId: string): Promise<ISpace> {
  return getSpaceByIdentifier(spaceId);
}

/**
 * Accepts either a space UUID (`id`) or a human-readable slug.
 * Keep this contract in sync with backend controller changes to avoid UI breakage.
 */
export async function getSpaceByIdentifier(
  spaceIdentifier: string,
): Promise<ISpace> {
  const req = await api.get<ISpace>(`/spaces/${spaceIdentifier}`);
  return req.data;
}

export async function getSpaceBySlug(spaceSlug: string): Promise<ISpace> {
  return getSpaceByIdentifier(spaceSlug);
}

export async function createSpace(data: Partial<ISpace>): Promise<ISpace> {
  const req = await api.post<ISpace>('/spaces', data);
  return req.data;
}

export async function updateSpace(data: Partial<ISpace>): Promise<ISpace> {
  const req = await api.patch<ISpace>(`/spaces/${data.spaceId}`, data);
  return req.data;
}

export async function archiveSpace(spaceId: string): Promise<ISpace> {
  const req = await api.post<ISpace>(`/spaces/${spaceId}/actions/archive`);
  return req.data;
}

export async function unarchiveSpace(spaceId: string): Promise<ISpace> {
  const req = await api.post<ISpace>(`/spaces/${spaceId}/actions/unarchive`);
  return req.data;
}

export async function deleteSpace(spaceId: string): Promise<void> {
  await api.delete<void>(`/spaces/${spaceId}`);
}

export async function getSpaceMembers(
  spaceId: string,
  params?: QueryParams,
): Promise<IPagination<ISpaceMember>> {
  const req = await api.get<any>("/spaces/members", {
    params: { spaceId, ...params },
  });
  return req.data;
}

export async function getSpacePolicyContext(
  spaceSlug: string,
): Promise<SpacePolicyContext> {
  const req = await api.get<SpacePolicyContext>("/spaces/policy-context", {
    params: { spaceSlug },
  });
  return req.data;
}

export async function addSpaceMember(data: IAddSpaceMember): Promise<void> {
  await api.post("/spaces/members/add", data);
}

export async function removeSpaceMember(
  data: IRemoveSpaceMember,
): Promise<void> {
  await api.post("/spaces/members/remove", data);
}

export async function changeMemberRole(
  data: IChangeSpaceMemberRole,
): Promise<void> {
  await api.post("/spaces/members/change-role", data);
}

export async function exportSpace(data: IExportSpaceParams): Promise<void> {
  /**
   * Export returns a binary file with `content-disposition` header,
   * so we explicitly request a blob response and keep full AxiosResponse.
   */
  const req = await api.post<Blob>('/spaces/actions/export', data, {
    responseType: 'blob',
    skipEnvelopeUnwrap: true,
  });

  downloadBlobFromAxiosResponse(req);
}

export async function getSpaceMemberUsers(
  spaceId: string,
  params?: QueryParams,
): Promise<{ items: SpaceUserInfo[]; limit: number }> {
  const req = await api.get("/spaces/member-users", {
    params: { spaceId, ...params },
  });
  return req.data;
}
