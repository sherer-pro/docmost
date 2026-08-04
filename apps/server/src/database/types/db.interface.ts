import {
  AiBuiltinToolSpacePolicies,
  AiBuiltinToolWorkspacePolicies,
  AiAuxRuns,
  AiChatFiles,
  AiConversationContextSources,
  AiConversations,
  AiFileUploadBatches,
  AiMcpGroupPolicies,
  AiMcpServers,
  AiMcpSpaceBindings,
  AiMcpUserPreferences,
  AiMcpWorkspaceSettings,
  AiMessages,
  AiMessageSources,
  AiRunContextSources,
  AiRuns,
  AiRunSteps,
  AiRunSourceDependencies,
  AiSpaceConfigs,
  ApiKeys,
  Attachments,
  AuthAccounts,
  AuthProviderGroupMappings,
  AuthProviderGroupMemberships,
  AuthProviders,
  Backlinks,
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
  PageEmbedGraphFences,
  PageTransclusions,
  PageTransclusionReferences,
  PageTemplateGroupPolicies,
  PageTemplateOperations,
  PageTemplateSpacePolicies,
  PageTemplateWorkspacePolicies,
  PageAccessRules,
  PushNotificationJobs,
  PageHistory,
  Pages,
  Shares,
  PushSubscriptions,
  SpaceMembers,
  Spaces,
  SsoLoginStates,
  UserMfa,
  UserSessions,
  Users,
  UserTokens,
  Watchers,
  WorkspaceInvitations,
  Workspaces,
} from '@docmost/db/types/db';

export interface DbInterface {
  aiBuiltinToolSpacePolicies: AiBuiltinToolSpacePolicies;
  aiBuiltinToolWorkspacePolicies: AiBuiltinToolWorkspacePolicies;
  aiAuxRuns: AiAuxRuns;
  aiChatFiles: AiChatFiles;
  aiConversationContextSources: AiConversationContextSources;
  aiConversations: AiConversations;
  aiFileUploadBatches: AiFileUploadBatches;
  aiMcpGroupPolicies: AiMcpGroupPolicies;
  aiMcpServers: AiMcpServers;
  aiMcpSpaceBindings: AiMcpSpaceBindings;
  aiMcpUserPreferences: AiMcpUserPreferences;
  aiMcpWorkspaceSettings: AiMcpWorkspaceSettings;
  aiMessages: AiMessages;
  aiMessageSources: AiMessageSources;
  aiRunContextSources: AiRunContextSources;
  aiRuns: AiRuns;
  aiRunSteps: AiRunSteps;
  aiRunSourceDependencies: AiRunSourceDependencies;
  aiSpaceConfigs: AiSpaceConfigs;
  attachments: Attachments;
  authAccounts: AuthAccounts;
  authProviderGroupMappings: AuthProviderGroupMappings;
  authProviderGroupMemberships: AuthProviderGroupMemberships;
  authProviders: AuthProviders;
  backlinks: Backlinks;
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
  pageTemplateGroupPolicies: PageTemplateGroupPolicies;
  pageTemplateOperations: PageTemplateOperations;
  pageTemplateSpacePolicies: PageTemplateSpacePolicies;
  pageTemplateWorkspacePolicies: PageTemplateWorkspacePolicies;
  pushNotificationJobs: PushNotificationJobs;
  pageHistory: PageHistory;
  pages: Pages;
  pageEmbedGraphFences: PageEmbedGraphFences;
  shares: Shares;
  pushSubscriptions: PushSubscriptions;
  spaceMembers: SpaceMembers;
  spaces: Spaces;
  ssoLoginStates: SsoLoginStates;
  userMfa: UserMfa;
  userSessions: UserSessions;
  users: Users;
  userTokens: UserTokens;
  watchers: Watchers;
  workspaceInvitations: WorkspaceInvitations;
  workspaces: Workspaces;
  apiKeys: ApiKeys;
}
