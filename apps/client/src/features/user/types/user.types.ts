import { IWorkspace } from "@/features/workspace/types/workspace.types";

export interface IUser {
  id: string;
  name: string;
  email: string;
  emailVerifiedAt: Date;
  avatarUrl: string;
  timezone: string;
  settings: IUserSettings;
  invitedById: string;
  lastLoginAt: string;
  lastActiveAt: Date;
  locale: string;
  createdAt: Date;
  updatedAt: Date;
  role: string;
  workspaceId: string;
  deactivatedAt: Date;
  deletedAt: Date;
  fullPageWidth: boolean; // used for update
  pageEditMode: string; // used for update
  pushEnabled: boolean; // used for update
  pushFrequency: PushFrequency; // used for update
  hasGeneratedPassword?: boolean;
  canAccessMembersDirectory?: boolean;
}

export interface ICurrentUser {
  user: IUser;
  workspace: IWorkspace;
}

export interface IUserSettings {
  preferences: {
    fullPageWidth: boolean;
    pageEditMode: string;
    pushEnabled: boolean;
    pushFrequency: PushFrequency;
  };
}

export type PushFrequency = "immediate" | "1h" | "3h" | "6h" | "24h";

export enum PageEditMode {
  Read = "read",
  Edit = "edit",
}
