import {
  AiAuxRuns,
  AiChatFiles,
  AiConversationContextSources,
  AiConversations,
  AiFileUploadBatches,
  AiMessages,
  AiMessageSources,
  AiRunContextSources,
  AiRuns,
  AiRunSourceDependencies,
  AiSpaceConfigs,
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
  DictionaryTermAliases,
  DictionaryTerms,
  Favorites,
  FileTasks,
  Groups,
  GroupUsers,
  Labels,
  Notifications,
  PageLabels,
  PageTransclusions,
  PageTransclusionReferences,
  PageAccessRules,
  PushNotificationJobs,
  PageHistory,
  Pages,
  Shares,
  PushSubscriptions,
  SpaceMembers,
  Spaces,
  UserMfa,
  UserSessions,
  Users,
  UserTokens,
  Watchers,
  WorkspaceInvitations,
  Workspaces,
} from '@docmost/db/types/db';
import { PageEmbeddings } from '@docmost/db/types/embeddings.types';

export interface DbInterface {
  aiAuxRuns: AiAuxRuns;
  aiChatFiles: AiChatFiles;
  aiConversationContextSources: AiConversationContextSources;
  aiConversations: AiConversations;
  aiFileUploadBatches: AiFileUploadBatches;
  aiMessages: AiMessages;
  aiMessageSources: AiMessageSources;
  aiRunContextSources: AiRunContextSources;
  aiRuns: AiRuns;
  aiRunSourceDependencies: AiRunSourceDependencies;
  aiSpaceConfigs: AiSpaceConfigs;
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
  dictionaryTerms: DictionaryTerms;
  dictionaryTermAliases: DictionaryTermAliases;
  favorites: Favorites;
  fileTasks: FileTasks;
  groups: Groups;
  groupUsers: GroupUsers;
  labels: Labels;
  notifications: Notifications;
  pageAccessRules: PageAccessRules;
  pageLabels: PageLabels;
  pageTransclusions: PageTransclusions;
  pageTransclusionReferences: PageTransclusionReferences;
  pushNotificationJobs: PushNotificationJobs;
  pageEmbeddings: PageEmbeddings;
  pageHistory: PageHistory;
  pages: Pages;
  shares: Shares;
  pushSubscriptions: PushSubscriptions;
  spaceMembers: SpaceMembers;
  spaces: Spaces;
  userMfa: UserMfa;
  userSessions: UserSessions;
  users: Users;
  userTokens: UserTokens;
  watchers: Watchers;
  workspaceInvitations: WorkspaceInvitations;
  workspaces: Workspaces;
  apiKeys: ApiKeys;
}
