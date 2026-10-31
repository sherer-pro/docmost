import type { Generated, Timestamp } from './db';

export interface IntegrationPreviewSettingsRow {
  workspaceId: string;
  enabled: boolean;
  updatedAt: Generated<Timestamp>;
}

export interface IntegrationPreviewConnections {
  id: string;
  workspaceId: string;
  userId: string;
  provider: 'github' | 'gitlab' | 'figma';
  credential: string;
  revision: Generated<number>;
  createdAt: Generated<Timestamp>;
  updatedAt: Generated<Timestamp>;
  lastUsedAt: Timestamp | null;
}
