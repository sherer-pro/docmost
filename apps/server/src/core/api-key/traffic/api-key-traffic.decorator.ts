import { SetMetadata } from '@nestjs/common';

export type ApiKeyTrafficProfile = 'rag' | 'mcp';

export const API_KEY_TRAFFIC_PROFILE = 'api-key-traffic-profile';

export const ApiKeyTraffic = (profile: ApiKeyTrafficProfile) =>
  SetMetadata(API_KEY_TRAFFIC_PROFILE, profile);
