import type {
  AiAgentToolVerifications,
  AiAssistantProfileGroupPolicies,
  AiAssistantProfileMcpTools,
  AiAssistantProfiles,
  AiAssistantProfileUserPreferences,
  AiAssistantProfileWorkspaceSettings,
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
  AttachmentCleanupBatches,
  AttachmentCleanupItems,
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
  FileTaskImportArtifacts,
  FileTaskImportPages,
  FileTasks,
  Groups,
  GroupUsers,
  Labels,
  Notifications,
  PageLabels,
  PageTransclusions,
  PageTransclusionReferences,
  PageTemplateGroupPolicies,
  PageTemplateAttachmentMappings,
  PageTemplateInstances,
  PageTemplateOperations,
  PageTemplatePublishConfirmations,
  PageTemplateRevisions,
  PageTemplateSpacePolicies,
  PageTemplateSyncItems,
  PageTemplateSyncRuns,
  PageTemplateWorkspacePolicies,
  PageAccessRules,
  PageDuplicateAttachmentPins,
  PushNotificationJobs,
  PageHistory,
  Pages,
  Shares,
  PushSubscriptions,
  QueueOutbox,
  RagSyncBindings,
  RagSyncTargetClaims,
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
  aiAgentToolVerifications: AiAgentToolVerifications;
  aiAssistantProfileGroupPolicies: AiAssistantProfileGroupPolicies;
  aiAssistantProfileMcpTools: AiAssistantProfileMcpTools;
  aiAssistantProfiles: AiAssistantProfiles;
  aiAssistantProfileUserPreferences: AiAssistantProfileUserPreferences;
  aiAssistantProfileWorkspaceSettings: AiAssistantProfileWorkspaceSettings;
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
  attachmentCleanupBatches: AttachmentCleanupBatches;
  attachmentCleanupItems: AttachmentCleanupItems;
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
  fileTaskImportArtifacts: FileTaskImportArtifacts;
  fileTaskImportPages: FileTaskImportPages;
  fileTasks: FileTasks;
  groups: Groups;
  groupUsers: GroupUsers;
  labels: Labels;
  notifications: Notifications;
  pageAccessRules: PageAccessRules;
  pageDuplicateAttachmentPins: PageDuplicateAttachmentPins;
  pageLabels: PageLabels;
  pageTransclusions: PageTransclusions;
  pageTransclusionReferences: PageTransclusionReferences;
  pageTemplateGroupPolicies: PageTemplateGroupPolicies;
  pageTemplateAttachmentMappings: PageTemplateAttachmentMappings;
  pageTemplateInstances: PageTemplateInstances;
  pageTemplateOperations: PageTemplateOperations;
  pageTemplatePublishConfirmations: PageTemplatePublishConfirmations;
  pageTemplateRevisions: PageTemplateRevisions;
  pageTemplateSpacePolicies: PageTemplateSpacePolicies;
  pageTemplateSyncItems: PageTemplateSyncItems;
  pageTemplateSyncRuns: PageTemplateSyncRuns;
  pageTemplateWorkspacePolicies: PageTemplateWorkspacePolicies;
  pushNotificationJobs: PushNotificationJobs;
  pageHistory: PageHistory;
  pages: Pages;
  shares: Shares;
  pushSubscriptions: PushSubscriptions;
  queueOutbox: QueueOutbox;
  ragSyncBindings: RagSyncBindings;
  ragSyncTargetClaims: RagSyncTargetClaims;
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
