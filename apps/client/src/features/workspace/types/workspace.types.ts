import { IPublicAuthProvider } from "@/features/security/types/security.types.ts";

export interface IWorkspace {
  id: string;
  name: string;
  description: string;
  logo: string;
  hostname: string;
  defaultSpaceId: string;
  customDomain: string;
  enableInvite: boolean;
  settings: IWorkspaceSettings;
  enforceSso: boolean;
  createdAt: Date;
  updatedAt: Date;
  emailDomains: string[];
  memberCount?: number;
  enforceMfa?: boolean;
  disablePublicSharing?: boolean;
  pageHistoryRetentionDays: number | null;
}

export interface IWorkspaceSettings {
  sharing?: IWorkspaceSharingSettings;
}

export interface IWorkspaceSharingSettings {
  disabled?: boolean;
}

export interface ICreateInvite {
  role: string;
  emails: string[];
  groupIds: string[];
}

export interface IInvitation {
  id: string;
  role: string;
  email: string;
  workspaceId: string;
  invitedById: string;
  createdAt: Date;
  enforceSso: boolean;
  passwordAllowed?: boolean;
  entrySpaceSlug?: string | null;
}

export interface IInvitationLink {
  inviteLink: string;
}

export interface IAcceptInvite {
  invitationId: string;
  name: string;
  password: string;
  token: string;
}

export interface IAcceptInviteResponse {
  requiresLogin?: boolean;
  entrySpaceSlug?: string;
}

export interface IPublicWorkspace {
  id: string;
  name: string;
  logo: string;
  hostname: string;
  enforceSso: boolean;
  authProviders: IPublicAuthProvider[];
}

export interface IVersion {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
}

export type MemberPresenceLocation = {
  type: "page" | "space" | "workspace";
  title: string;
  path: string | null;
  pageId?: string;
  spaceId?: string;
  spaceName?: string | null;
  spaceSlug?: string | null;
};

export type MemberPresenceSession = {
  sessionKey: string;
  sessionId: string | null;
  isLegacy: boolean;
  deviceName: string | null;
  lastSeenAt: string;
  locations: MemberPresenceLocation[];
};

export type MemberPresence = {
  isOnline: boolean;
  lastSeenAt: string | null;
  sessions: MemberPresenceSession[];
};

export type WorkspaceMembersPresenceResponse = {
  users: Record<string, MemberPresence>;
};
