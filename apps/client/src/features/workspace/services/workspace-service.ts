import api from "@/lib/api-client";
import { IUser } from "@/features/user/types/user.types";
import {
  ICreateInvite,
  IInvitation,
  IWorkspace,
  IAcceptInvite,
  IAcceptInviteResponse,
  IPublicWorkspace,
  IInvitationLink,
  IVersion,
  WorkspaceMembersPresenceResponse,
} from "../types/workspace.types";
import { IPagination, QueryParams } from "@/lib/types.ts";
import { ISetupWorkspace } from "@/features/auth/types/auth.types.ts";

export async function getWorkspace(): Promise<IWorkspace> {
  const req = await api.get<IWorkspace>("/workspace/info");
  return req.data;
}

export async function getWorkspacePublicData(
  spaceSlug?: string,
): Promise<IPublicWorkspace> {
  const req = await api.get<IPublicWorkspace>("/workspace/public", {
    params: spaceSlug ? { spaceSlug } : undefined,
  });
  return req.data;
}

export async function getCheckHostname(
  hostname: string,
): Promise<{ hostname: string }> {
  const req = await api.post("/workspace/check-hostname", { hostname });
  return req.data;
}

export async function getWorkspaceMembers(
  params?: QueryParams,
): Promise<IPagination<IUser>> {
  const req = await api.get("/workspace/members", { params });
  return req.data;
}

export async function getWorkspaceVisibleMembersCount(): Promise<{
  count: number;
}> {
  const req = await api.get<{ count: number }>("/workspace/members/count");
  return req.data;
}

export async function getWorkspaceMembersPresence(
  userIds: string[],
): Promise<WorkspaceMembersPresenceResponse> {
  if (userIds.length === 0) {
    return { users: {} };
  }

  const req = await api.get<WorkspaceMembersPresenceResponse>(
    "/workspace/members/presence",
    { params: { userIds: userIds.join(",") } },
  );
  return req.data;
}

export async function deleteWorkspaceMember(data: {
  userId: string;
}): Promise<void> {
  await api.post("/workspace/members/delete", data);
}

export async function deactivateWorkspaceMember(data: {
  userId: string;
}): Promise<{ success: true }> {
  const req = await api.post<{ success: true }>(
    "/workspace/members/deactivate",
    data,
  );
  return req.data;
}

export async function updateWorkspace(data: Partial<IWorkspace>) {
  const req = await api.post<IWorkspace>("/workspace/update", data);
  return req.data;
}

export async function changeMemberRole(data: {
  userId: string;
  role: string;
}): Promise<void> {
  await api.post("/workspace/members/change-role", data);
}

export async function getPendingInvitations(
  params?: QueryParams,
): Promise<IPagination<IInvitation>> {
  const req = await api.get("/workspace/invites", { params });
  return req.data;
}

export async function createInvitation(data: ICreateInvite) {
  const req = await api.post("/workspace/invites/create", data);
  return req.data;
}

export async function acceptInvitation(
  data: IAcceptInvite,
): Promise<IAcceptInviteResponse> {
  const req = await api.post("/workspace/invites/accept", data);
  return req.data;
}

export async function getInviteLink(data: {
  invitationId: string;
}): Promise<IInvitationLink> {
  const req = await api.post("/workspace/invites/link", data);
  return req.data;
}

export async function resendInvitation(data: {
  invitationId: string;
}): Promise<void> {
  await api.post("/workspace/invites/resend", data);
}

export async function revokeInvitation(data: {
  invitationId: string;
}): Promise<void> {
  await api.post("/workspace/invites/revoke", data);
}

export async function getInvitationById(data: {
  invitationId: string;
  token: string;
}): Promise<IInvitation> {
  const req = await api.get("/workspace/invites/info", { params: data });
  return req.data;
}

export async function createWorkspace(
  data: ISetupWorkspace,
): Promise<{ workspace: IWorkspace } & { exchangeToken: string }> {
  const req = await api.post("/workspace/create", data);
  return req.data;
}

export async function getAppVersion(): Promise<IVersion> {
  const req = await api.post("/version");
  return req.data;
}
