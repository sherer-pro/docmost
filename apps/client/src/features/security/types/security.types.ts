import { SSO_PROVIDER } from "@/features/security/constants.ts";

export interface IAuthProvider {
  id: string;
  name: string;
  type: SSO_PROVIDER;
  samlUrl: string | null;
  samlCertificate: string | null;
  oidcIssuer: string | null;
  oidcClientId: string | null;
  oidcClientSecret: string;
  ldapUrl: string | null;
  ldapBindDn: string | null;
  ldapBindPassword: string;
  ldapBaseDn: string | null;
  ldapUserSearchFilter: string | null;
  ldapUserAttributes: Record<string, unknown> | null;
  ldapTlsEnabled: boolean | null;
  ldapTlsCaCert: string | null;
  allowSignup: boolean;
  isEnabled: boolean;
  groupSync: boolean;
  creatorId: string | null;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type IPublicAuthProvider = Pick<IAuthProvider, "id" | "name" | "type">;

export type ICreateAuthProvider = Pick<IAuthProvider, "name" | "type">;

export type IUpdateAuthProvider = Partial<IAuthProvider> & {
  providerId: string;
};
