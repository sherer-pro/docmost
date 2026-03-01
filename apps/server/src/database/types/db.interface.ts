import {
  ApiKeys,
  Attachments,
  AuthAccounts,
  AuthProviders,
  Backlinks,
  Billing,
  Comments,
  Databases,
  DatabaseProperties,
  DatabaseRows,
  DatabaseCells,
  DatabaseViews,
  FileTasks,
  Groups,
  GroupUsers,
  Notifications,
  PushNotificationJobs,
  PageHistory,
  Pages,
  Shares,
  PushSubscriptions,
  SpaceMembers,
  Spaces,
  UserMfa,
  Users,
  UserTokens,
  Watchers,
  WorkspaceInvitations,
  Workspaces,
} from '@docmost/db/types/db';
import { PageEmbeddings } from '@docmost/db/types/embeddings.types';

export interface DbInterface {
  attachments: Attachments;
  authAccounts: AuthAccounts;
  authProviders: AuthProviders;
  backlinks: Backlinks;
  billing: Billing;
  comments: Comments;
  databases: Databases;
  databaseProperties: DatabaseProperties;
  databaseRows: DatabaseRows;
  databaseCells: DatabaseCells;
  databaseViews: DatabaseViews;
  fileTasks: FileTasks;
  groups: Groups;
  groupUsers: GroupUsers;
  notifications: Notifications;
  pushNotificationJobs: PushNotificationJobs;
  pageEmbeddings: PageEmbeddings;
  pageHistory: PageHistory;
  pages: Pages;
  shares: Shares;
  pushSubscriptions: PushSubscriptions;
  spaceMembers: SpaceMembers;
  spaces: Spaces;
  userMfa: UserMfa;
  users: Users;
  userTokens: UserTokens;
  watchers: Watchers;
  workspaceInvitations: WorkspaceInvitations;
  workspaces: Workspaces;
  apiKeys: ApiKeys;
}
