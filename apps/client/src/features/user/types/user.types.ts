import { IWorkspace } from "@/features/workspace/types/workspace.types";
import type { AuthenticationAssurance } from "@docmost/api-contract";

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
  fixedToolbar: boolean; // used for update
  fullPageWidthByPageId?: Record<string, boolean>; // used for update
  headingNumberingByPageId?: Record<string, boolean>; // used for update
  pageEditModeByPageId?: Record<string, PageEditMode>; // used for update
  aiPanelOpen?: boolean; // used for update
  aiPanelWidth?: number; // used for update
  aiPanelTab?: AsideTabPreference; // used for update
  pushEnabled: boolean; // used for update
  emailEnabled: boolean; // used for update
  emailFrequency: EmailFrequency; // used for update
  pushFrequency: PushFrequency; // used for update
  hasGeneratedPassword?: boolean;
  canAccessMembersDirectory?: boolean;
}

export interface ICurrentUser {
  user: IUser;
  workspace: IWorkspace;
  authenticationAssurance?: AuthenticationAssurance;
}

export interface IUserSettings {
  preferences: {
    fullPageWidth: boolean;
    fixedToolbar: boolean;
    fullPageWidthByPageId?: Record<string, boolean>;
    headingNumberingByPageId?: Record<string, boolean>;
    pageEditModeByPageId?: Record<string, PageEditMode>;
    aiPanelOpen: boolean;
    aiPanelWidth: number;
    aiPanelTab: AsideTabPreference;
    pushEnabled: boolean;
    emailEnabled: boolean;
    emailFrequency: EmailFrequency;
    pushFrequency: PushFrequency;
  };
}

export type NotificationFrequency = "immediate" | "1h" | "3h" | "6h" | "24h";
export type PushFrequency = NotificationFrequency;
export type EmailFrequency = NotificationFrequency;

export enum PageEditMode {
  Read = "read",
  Edit = "edit",
}

export type AsideTabPreference = "" | "comments" | "toc" | "ai";
