export type SpacePolicyOverride = boolean | null;

export type AuthenticationRequirement = 'sso' | 'mfa';

export interface SpacePolicyValues {
  enforceMfa: boolean;
  enforceSso: boolean;
  disablePublicSharing: boolean;
}

export interface SpacePolicyOverrides {
  enforceMfa: SpacePolicyOverride;
  enforceSso: SpacePolicyOverride;
  disablePublicSharing: SpacePolicyOverride;
}

export interface SpacePolicy {
  overrides: SpacePolicyOverrides;
  effective: SpacePolicyValues;
}

export interface SpacePolicyContext {
  id: string;
  slug: string;
  name: string;
  policy: SpacePolicy;
  requiresStepUp: boolean;
}

export interface AuthenticationAssurance {
  ssoVerified: boolean;
  mfaVerified: boolean;
  workspaceRequirements: AuthenticationRequirement[];
  workspaceMissingRequirements: AuthenticationRequirement[];
}

export interface AuthenticationAssuranceRequiredError {
  statusCode: 428;
  code: 'AUTHENTICATION_ASSURANCE_REQUIRED';
  message: string;
  scope: 'workspace' | 'space';
  spaceId: string | null;
  requirements: AuthenticationRequirement[];
}
