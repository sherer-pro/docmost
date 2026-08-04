import type {
  AuthenticationRequirement,
  SpacePolicy,
  SpacePolicyValues,
} from '@docmost/api-contract';
import type { Space, UserSession, Workspace } from '@docmost/db/types/entity.types';

export type SpaceWithPolicy = Space & { policy: SpacePolicy };

export type WorkspacePolicySource = Pick<
  Workspace,
  'enforceMfa' | 'enforceSso' | 'settings'
>;

export type SessionAssuranceSource = Pick<
  UserSession,
  'ssoVerifiedAt' | 'mfaVerifiedAt'
>;

export interface AuthenticationPolicyEvaluation {
  requirements: AuthenticationRequirement[];
  missingRequirements: AuthenticationRequirement[];
  satisfied: boolean;
}

export type PolicyKey = keyof SpacePolicyValues;
