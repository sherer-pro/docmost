import { Insertable, Selectable, Updateable } from 'kysely';
import {
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
  AiSpaceContentExclusions,
  AiSpaceContentPolicies,
  AiSpaceConfigs,
  Attachments,
  Comments,
  Databases,
  DatabaseProperties,
  DatabaseRows,
  DatabaseCells,
  DatabaseViews,
  DictionaryTermAliases,
  DictionaryTerms,
  Favorites,
  Groups,
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
  Pages,
  Spaces,
  Users,
  Workspaces,
  PageHistory as History,
  GroupUsers,
  SpaceMembers,
  WorkspaceInvitations,
  UserTokens,
  Backlinks,
  AuthProviders,
  AuthAccounts,
  AuthProviderGroupMappings,
  AuthProviderGroupMemberships,
  Shares,
  FileTasks,
  UserMfa as _UserMFA,
  UserSessions,
  ApiKeys,
  Watchers,
  PushSubscriptions,
  PushNotificationJobs,
  QueueOutbox,
  RagSyncBindings,
  RagSyncTargetClaims,
  JsonValue,
  PageAccessRules,
  SsoLoginStates,
} from './db';
import type { PageAiRole } from '@docmost/api-contract';

/**
 * Document field settings at the space level.
 */
export interface SpaceDocumentFieldsSettings {
  status?: boolean;
  assignee?: boolean;
  stakeholders?: boolean;
  aiRole?: boolean;
  readingTime?: boolean;
}

/**
 * Dictionary feature switch at the space level.
 */
export interface SpaceDictionarySettings {
  enabled?: boolean;
}

export interface SpaceTagSettings {
  disabled?: string[];
}

export type HeadingNumberingSettings = {
  enabled?: boolean;
} & Record<string, JsonValue>;

/**
 * A single admin-managed custom link shown in the space sidebar.
 */
export interface SpaceCustomLink {
  id: string;
  label: string;
  url: string;
  icon: string;
}

/**
 * Admin-managed custom links at the space level.
 */
export interface SpaceCustomLinksSettings {
  links?: SpaceCustomLink[];
}

export interface SpaceSecuritySettings {
  enforceMfa?: boolean;
  enforceSso?: boolean;
}

export interface SpaceSharingSettings {
  disabled?: boolean;
}

/**
 * Space settings container.
 */
export interface SpaceSettings {
  documentFields?: SpaceDocumentFieldsSettings;
  dictionary?: SpaceDictionarySettings;
  tags?: SpaceTagSettings;
  headingNumbering?: HeadingNumberingSettings;
  customLinks?: SpaceCustomLinksSettings;
  security?: SpaceSecuritySettings;
  sharing?: SpaceSharingSettings;
}

/**
 * Extendable page settings.
 */
export interface PageSettings {
  status?: string | null;
  assigneeId?: string | null;
  stakeholderIds?: string[] | null;
  aiRole?: PageAiRole;
  [key: string]: JsonValue | undefined;
}

// AI space configuration
export type AiSpaceConfig = Selectable<AiSpaceConfigs>;
export type InsertableAiSpaceConfig = Insertable<AiSpaceConfigs>;
export type UpdatableAiSpaceConfig = Updateable<Omit<AiSpaceConfigs, 'id'>>;

export type AiAssistantProfile = Selectable<AiAssistantProfiles>;
export type InsertableAiAssistantProfile = Insertable<AiAssistantProfiles>;
export type UpdatableAiAssistantProfile = Updateable<
  Omit<AiAssistantProfiles, 'id'>
>;
export type AiAssistantProfileMcpTool = Selectable<AiAssistantProfileMcpTools>;
export type AiAssistantProfileGroupPolicy =
  Selectable<AiAssistantProfileGroupPolicies>;
export type AiAssistantProfileWorkspaceSetting =
  Selectable<AiAssistantProfileWorkspaceSettings>;
export type AiAssistantProfileUserPreference =
  Selectable<AiAssistantProfileUserPreferences>;
export type AiAgentToolVerification = Selectable<AiAgentToolVerifications>;

export type AiSpaceContentPolicyEntity = Selectable<AiSpaceContentPolicies>;
export type AiSpaceContentExclusionEntity =
  Selectable<AiSpaceContentExclusions>;

export type RagSyncBinding = Selectable<RagSyncBindings>;
export type InsertableRagSyncBinding = Insertable<RagSyncBindings>;
export type UpdatableRagSyncBinding = Updateable<Omit<RagSyncBindings, 'id'>>;
export type RagSyncTargetClaim = Selectable<RagSyncTargetClaims>;
export type InsertableRagSyncTargetClaim = Insertable<RagSyncTargetClaims>;
export type UpdatableRagSyncTargetClaim = Updateable<
  Omit<RagSyncTargetClaims, 'id'>
>;

// AI conversation
export type AiConversation = Selectable<AiConversations>;
export type InsertableAiConversation = Insertable<AiConversations>;
export type UpdatableAiConversation = Updateable<Omit<AiConversations, 'id'>>;

// AI conversation context source
export type AiConversationContextSource =
  Selectable<AiConversationContextSources>;
export type InsertableAiConversationContextSource =
  Insertable<AiConversationContextSources>;
export type UpdatableAiConversationContextSource = Updateable<
  Omit<AiConversationContextSources, 'id'>
>;

// AI file upload batch
export type AiFileUploadBatch = Selectable<AiFileUploadBatches>;
export type InsertableAiFileUploadBatch = Insertable<AiFileUploadBatches>;
export type UpdatableAiFileUploadBatch = Updateable<
  Omit<AiFileUploadBatches, 'id'>
>;

// AI message
export type AiMessage = Selectable<AiMessages>;
export type InsertableAiMessage = Insertable<AiMessages>;
export type UpdatableAiMessage = Updateable<Omit<AiMessages, 'id'>>;

// AI run
export type AiRun = Selectable<AiRuns>;
export type InsertableAiRun = Insertable<AiRuns>;
export type UpdatableAiRun = Updateable<Omit<AiRuns, 'id'>>;

// AI run tool step
export type AiRunStep = Selectable<AiRunSteps>;
export type InsertableAiRunStep = Insertable<AiRunSteps>;
export type UpdatableAiRunStep = Updateable<Omit<AiRunSteps, 'id'>>;

export type AiBuiltinToolWorkspacePolicy =
  Selectable<AiBuiltinToolWorkspacePolicies>;
export type AiBuiltinToolSpacePolicy = Selectable<AiBuiltinToolSpacePolicies>;

// AI run context source
export type AiRunContextSource = Selectable<AiRunContextSources>;
export type InsertableAiRunContextSource = Insertable<AiRunContextSources>;

// AI run source dependency
export type AiRunSourceDependency = Selectable<AiRunSourceDependencies>;
export type InsertableAiRunSourceDependency =
  Insertable<AiRunSourceDependencies>;

// AI auxiliary run
export type AiAuxRun = Selectable<AiAuxRuns>;
export type InsertableAiAuxRun = Insertable<AiAuxRuns>;
export type UpdatableAiAuxRun = Updateable<Omit<AiAuxRuns, 'id'>>;

// AI chat file
export type AiChatFile = Selectable<AiChatFiles>;
export type InsertableAiChatFile = Insertable<AiChatFiles>;
export type UpdatableAiChatFile = Updateable<Omit<AiChatFiles, 'id'>>;

// AI message source
export type AiMessageSource = Selectable<AiMessageSources>;
export type InsertableAiMessageSource = Insertable<AiMessageSources>;
export type UpdatableAiMessageSource = Updateable<Omit<AiMessageSources, 'id'>>;

// External MCP workspace settings
export type AiMcpWorkspaceSetting = Selectable<AiMcpWorkspaceSettings>;
export type InsertableAiMcpWorkspaceSetting =
  Insertable<AiMcpWorkspaceSettings>;
export type UpdatableAiMcpWorkspaceSetting = Updateable<
  Omit<AiMcpWorkspaceSettings, 'id'>
>;

// External MCP server connection
export type AiMcpServer = Selectable<AiMcpServers>;
export type InsertableAiMcpServer = Insertable<AiMcpServers>;
export type UpdatableAiMcpServer = Updateable<Omit<AiMcpServers, 'id'>>;

// External MCP space binding
export type AiMcpSpaceBinding = Selectable<AiMcpSpaceBindings>;
export type InsertableAiMcpSpaceBinding = Insertable<AiMcpSpaceBindings>;
export type UpdatableAiMcpSpaceBinding = Updateable<
  Omit<AiMcpSpaceBindings, 'id'>
>;

// External MCP group policy
export type AiMcpGroupPolicy = Selectable<AiMcpGroupPolicies>;
export type InsertableAiMcpGroupPolicy = Insertable<AiMcpGroupPolicies>;
export type UpdatableAiMcpGroupPolicy = Updateable<
  Omit<AiMcpGroupPolicies, 'id'>
>;

// External MCP user preference
export type AiMcpUserPreference = Selectable<AiMcpUserPreferences>;
export type InsertableAiMcpUserPreference = Insertable<AiMcpUserPreferences>;
export type UpdatableAiMcpUserPreference = Updateable<
  Omit<AiMcpUserPreferences, 'id'>
>;

// Workspace
export type Workspace = Selectable<Workspaces>;
export type InsertableWorkspace = Insertable<Workspaces>;
export type UpdatableWorkspace = Updateable<Omit<Workspaces, 'id'>>;

// WorkspaceInvitation
export type WorkspaceInvitation = Selectable<WorkspaceInvitations>;
export type InsertableWorkspaceInvitation = Insertable<WorkspaceInvitations>;
export type UpdatableWorkspaceInvitation = Updateable<
  Omit<WorkspaceInvitations, 'id'>
>;

// User
export type User = Selectable<Users>;
export type InsertableUser = Insertable<Users>;
export type UpdatableUser = Updateable<Omit<Users, 'id'>>;

// Space
export type Space = Selectable<Spaces>;
export type InsertableSpace = Insertable<Spaces>;
export type UpdatableSpace = Updateable<Omit<Spaces, 'id'>>;

// SpaceMember
export type SpaceMember = Selectable<SpaceMembers>;
export type InsertableSpaceMember = Insertable<SpaceMembers>;
export type UpdatableSpaceMember = Updateable<Omit<SpaceMembers, 'id'>>;

// Group
export type ExtendedGroup = Groups & { memberCount: number };

export type Group = Selectable<Groups>;
export type InsertableGroup = Insertable<Groups>;
export type UpdatableGroup = Updateable<Omit<Groups, 'id'>>;

// GroupUser
export type GroupUser = Selectable<GroupUsers>;
export type InsertableGroupUser = Insertable<GroupUsers>;
export type UpdatableGroupUser = Updateable<Omit<GroupUsers, 'id'>>;

// Page
export type Page = Selectable<Pages>;
export type InsertablePage = Insertable<Pages>;
export type UpdatablePage = Updateable<Omit<Pages, 'id'>>;

// PageHistory
export type PageHistory = Selectable<History>;
export type InsertablePageHistory = Insertable<History>;
export type UpdatablePageHistory = Updateable<Omit<History, 'id'>>;

// PageAccessRule
export type PageAccessRule = Selectable<PageAccessRules>;
export type InsertablePageAccessRule = Insertable<PageAccessRules>;
export type UpdatablePageAccessRule = Updateable<Omit<PageAccessRules, 'id'>>;

// Comment
export type Comment = Selectable<Comments>;
export type InsertableComment = Insertable<Comments>;
export type UpdatableComment = Updateable<Omit<Comments, 'id'>>;

// Database
export type Database = Selectable<Databases>;
export type InsertableDatabase = Insertable<Databases>;
export type UpdatableDatabase = Updateable<Omit<Databases, 'id'>>;

// DatabaseProperty
export type DatabaseProperty = Selectable<DatabaseProperties>;
export type InsertableDatabaseProperty = Insertable<DatabaseProperties>;
export type UpdatableDatabaseProperty = Updateable<
  Omit<DatabaseProperties, 'id'>
>;

// DatabaseRow
export type DatabaseRow = Selectable<DatabaseRows>;
export type InsertableDatabaseRow = Insertable<DatabaseRows>;
export type UpdatableDatabaseRow = Updateable<Omit<DatabaseRows, 'id'>>;

// DatabaseCell
export type DatabaseCell = Selectable<DatabaseCells>;
export type InsertableDatabaseCell = Insertable<DatabaseCells>;
export type UpdatableDatabaseCell = Updateable<Omit<DatabaseCells, 'id'>>;

// DatabaseView
export type DatabaseView = Selectable<DatabaseViews>;
export type InsertableDatabaseView = Insertable<DatabaseViews>;
export type UpdatableDatabaseView = Updateable<Omit<DatabaseViews, 'id'>>;

// DictionaryTerm
export type DictionaryTerm = Selectable<DictionaryTerms>;
export type InsertableDictionaryTerm = Insertable<DictionaryTerms>;
export type UpdatableDictionaryTerm = Updateable<Omit<DictionaryTerms, 'id'>>;

// DictionaryTermAlias
export type DictionaryTermAlias = Selectable<DictionaryTermAliases>;
export type InsertableDictionaryTermAlias = Insertable<DictionaryTermAliases>;
export type UpdatableDictionaryTermAlias = Updateable<
  Omit<DictionaryTermAliases, 'id'>
>;

// Favorite
export type Favorite = Selectable<Favorites>;
export type InsertableFavorite = Insertable<Favorites>;
export type UpdatableFavorite = Updateable<Omit<Favorites, 'id'>>;

// Label
export type Label = Selectable<Labels>;
export type InsertableLabel = Insertable<Labels>;
export type UpdatableLabel = Updateable<Omit<Labels, 'id'>>;

// PageLabel
export type PageLabel = Selectable<PageLabels>;
export type InsertablePageLabel = Insertable<PageLabels>;
export type UpdatablePageLabel = Updateable<Omit<PageLabels, 'id'>>;

// PageTransclusion
export type PageTransclusion = Selectable<PageTransclusions>;
export type InsertablePageTransclusion = Insertable<PageTransclusions>;
export type UpdatablePageTransclusion = Updateable<
  Omit<PageTransclusions, 'id'>
>;

// PageTransclusionReference
export type PageTransclusionReference = Selectable<PageTransclusionReferences>;
export type InsertablePageTransclusionReference =
  Insertable<PageTransclusionReferences>;
export type UpdatablePageTransclusionReference = Updateable<
  Omit<PageTransclusionReferences, 'id'>
>;

export type PageTemplateWorkspacePolicy =
  Selectable<PageTemplateWorkspacePolicies>;
export type PageTemplateSpacePolicy = Selectable<PageTemplateSpacePolicies>;
export type PageTemplateGroupPolicy = Selectable<PageTemplateGroupPolicies>;
export type PageTemplateOperation = Selectable<PageTemplateOperations>;
export type PageTemplateRevision = Selectable<PageTemplateRevisions>;
export type PageTemplateInstance = Selectable<PageTemplateInstances>;
export type PageTemplateSyncRun = Selectable<PageTemplateSyncRuns>;
export type PageTemplateSyncItem = Selectable<PageTemplateSyncItems>;
export type PageTemplateAttachmentMapping =
  Selectable<PageTemplateAttachmentMappings>;
export type PageTemplatePublishConfirmation =
  Selectable<PageTemplatePublishConfirmations>;

// Attachment
export type Attachment = Selectable<Attachments>;
export type InsertableAttachment = Insertable<Attachments>;
export type UpdatableAttachment = Updateable<Omit<Attachments, 'id'>>;

// User Token
export type UserToken = Selectable<UserTokens>;
export type InsertableUserToken = Insertable<UserTokens>;
export type UpdatableUserToken = Updateable<Omit<UserTokens, 'id'>>;

// User Session
export type UserSession = Selectable<UserSessions>;
export type InsertableUserSession = Insertable<UserSessions>;
export type UpdatableUserSession = Updateable<Omit<UserSessions, 'id'>>;

// Backlink
export type Backlink = Selectable<Backlinks>;
export type InsertableBacklink = Insertable<Backlink>;
export type UpdatableBacklink = Updateable<Omit<Backlink, 'id'>>;

// Auth Provider
export type AuthProvider = Selectable<AuthProviders>;
export type InsertableAuthProvider = Insertable<AuthProviders>;
export type UpdatableAuthProvider = Updateable<Omit<AuthProviders, 'id'>>;

// Auth Account
export type AuthAccount = Selectable<AuthAccounts>;
export type InsertableAuthAccount = Insertable<AuthAccounts>;
export type UpdatableAuthAccount = Updateable<Omit<AuthAccounts, 'id'>>;

export type AuthProviderGroupMapping = Selectable<AuthProviderGroupMappings>;
export type AuthProviderGroupMembership =
  Selectable<AuthProviderGroupMemberships>;
export type SsoLoginState = Selectable<SsoLoginStates>;

// Share
export type Share = Selectable<Shares>;
export type InsertableShare = Insertable<Shares>;
export type UpdatableShare = Updateable<Omit<Shares, 'id'>>;

// File Task
export type FileTask = Selectable<FileTasks>;
export type InsertableFileTask = Insertable<FileTasks>;
export type UpdatableFileTask = Updateable<Omit<FileTasks, 'id'>>;

// UserMFA
export type UserMFA = Selectable<_UserMFA>;
export type InsertableUserMFA = Insertable<_UserMFA>;
export type UpdatableUserMFA = Updateable<Omit<_UserMFA, 'id'>>;

// Api Keys
export type ApiKey = Selectable<ApiKeys>;
export type InsertableApiKey = Insertable<ApiKeys>;
export type UpdatableApiKey = Updateable<Omit<ApiKeys, 'id'>>;

// Notification
export type Notification = Selectable<Notifications>;
export type InsertableNotification = Insertable<Notifications>;
export type UpdatableNotification = Updateable<Omit<Notifications, 'id'>>;

// Watcher
export type Watcher = Selectable<Watchers>;
export type InsertableWatcher = Insertable<Watchers>;
export type UpdatableWatcher = Updateable<Omit<Watchers, 'id'>>;

// PushSubscription
export type PushSubscription = Selectable<PushSubscriptions>;
export type InsertablePushSubscription = Insertable<PushSubscriptions>;
export type UpdatablePushSubscription = Updateable<
  Omit<PushSubscriptions, 'id'>
>;

// PushNotificationJob
export type PushNotificationJob = Selectable<PushNotificationJobs>;
export type InsertablePushNotificationJob = Insertable<PushNotificationJobs>;
export type UpdatablePushNotificationJob = Updateable<
  Omit<PushNotificationJobs, 'id'>
>;

// Queue outbox
export type QueueOutboxEntry = Selectable<QueueOutbox>;
export type InsertableQueueOutboxEntry = Insertable<QueueOutbox>;
export type UpdatableQueueOutboxEntry = Updateable<Omit<QueueOutbox, 'id'>>;
