import { User } from '@docmost/db/types/entity.types';

export const PRESENCE_LOCATION_TYPES = ['page', 'space', 'workspace'] as const;

export type PresenceLocationType = (typeof PRESENCE_LOCATION_TYPES)[number];

export interface PresenceLocation {
  type: PresenceLocationType;
  title: string;
  path: string | null;
  pageId?: string;
  spaceId?: string;
  spaceName?: string | null;
  spaceSlug?: string | null;
}

export interface PresenceUpdateInput {
  type?: PresenceLocationType;
  pageId?: string;
  spaceId?: string;
  path?: string;
  tabId?: string;
}

export interface PresenceConnectionContext {
  socketId: string;
  user: User;
  sessionId?: string | null;
  deviceName?: string | null;
}

export interface StoredPresenceConnection {
  socketId: string;
  userId: string;
  workspaceId: string;
  sessionId: string | null;
  tabId: string | null;
  deviceName: string | null;
  location: PresenceLocation;
  lastSeenAt: string;
}

export interface MemberPresenceSession {
  sessionKey: string;
  sessionId: string | null;
  isLegacy: boolean;
  deviceName: string | null;
  lastSeenAt: string;
  locations: PresenceLocation[];
}

export interface MemberPresence {
  isOnline: boolean;
  lastSeenAt: string | null;
  sessions: MemberPresenceSession[];
}

export interface WorkspaceMembersPresenceResponse {
  users: Record<string, MemberPresence>;
}
