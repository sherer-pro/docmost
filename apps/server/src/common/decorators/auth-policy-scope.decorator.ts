import { SetMetadata } from '@nestjs/common';

export const AUTH_POLICY_SCOPE_KEY = 'auth-policy-scope';

export type AuthPolicyScopeType =
  | 'bootstrap'
  | 'workspace'
  | 'space'
  | 'page'
  | 'resource';

export type AuthPolicyResourceType =
  | 'attachment'
  | 'comment'
  | 'database'
  | 'dictionaryTerm'
  | 'fileTask'
  | 'pageHistory'
  | 'share';

export interface AuthPolicyScopeMetadata {
  scope: AuthPolicyScopeType;
  key?: string;
  source?: 'params' | 'query' | 'body';
  resourceType?: AuthPolicyResourceType;
  optional?: boolean;
  fallbackKey?: string;
  fallbackScope?: 'page' | 'space';
  additionalTargets?: Array<{
    scope: 'page' | 'space';
    key: string;
    source?: 'params' | 'query' | 'body';
    optional?: boolean;
  }>;
}

export const AuthPolicyScope = (
  scope: AuthPolicyScopeType,
  options: Omit<AuthPolicyScopeMetadata, 'scope'> = {},
) => SetMetadata(AUTH_POLICY_SCOPE_KEY, { scope, ...options });
