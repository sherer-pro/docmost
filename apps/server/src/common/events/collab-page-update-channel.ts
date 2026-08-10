import { randomUUID } from 'node:crypto';

export const COLLAB_PAGE_UPDATE_REDIS_CHANNEL =
  'docmost:collab:page-updated:v1';

export const COLLAB_PAGE_UPDATE_PROCESS_ID = randomUUID();

export type CollabPageUpdateMessage = {
  version: 1;
  origin: string;
  pageIds: string[];
  workspaceId: string;
};
