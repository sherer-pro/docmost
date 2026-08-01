import { AuthProvider } from '@docmost/db/types/entity.types';
import { SSO_PROVIDER_TYPES } from './dto/sso.dto';

export function isUsableSsoProvider(
  provider: Pick<
    AuthProvider,
    | 'type'
    | 'oidcIssuer'
    | 'oidcClientId'
    | 'oidcClientSecret'
    | 'samlUrl'
    | 'samlCertificate'
    | 'ldapUrl'
    | 'ldapBindDn'
    | 'ldapBindPassword'
    | 'ldapBaseDn'
    | 'ldapTlsEnabled'
    | 'ldapUserSearchFilter'
  >,
): boolean {
  if (!SSO_PROVIDER_TYPES.includes(provider.type as any)) {
    return false;
  }
  if (provider.type === 'oidc') {
    return Boolean(
      provider.oidcIssuer &&
        provider.oidcClientId &&
        provider.oidcClientSecret,
    );
  }
  if (provider.type === 'saml') {
    return Boolean(provider.samlUrl && provider.samlCertificate);
  }
  if (provider.type === 'ldap') {
    const secureTransport =
      provider.ldapUrl?.toLowerCase().startsWith('ldaps://') ||
      provider.ldapTlsEnabled === true;
    const filter = provider.ldapUserSearchFilter || '(mail={{username}})';
    return Boolean(
      provider.ldapUrl &&
        provider.ldapBindDn &&
        provider.ldapBindPassword &&
        provider.ldapBaseDn &&
        secureTransport &&
        filter.includes('{{username}}'),
    );
  }
  return false;
}

/**
 * Fields whose change invalidates a previous successful configuration test.
 */
export const SECURITY_CRITICAL_PROVIDER_FIELDS = [
  'oidcIssuer',
  'oidcClientId',
  'oidcClientSecret',
  'samlUrl',
  'samlCertificate',
  'ldapUrl',
  'ldapBindDn',
  'ldapBindPassword',
  'ldapBaseDn',
  'ldapUserSearchFilter',
  'ldapUserAttributes',
  'ldapTlsEnabled',
  'ldapTlsCaCert',
] as const;

/**
 * SSO may only be enforced through a provider that is completely configured,
 * was verified against the live identity provider, and has already signed a
 * user in at least once. This is what keeps a workspace from locking itself out.
 */
export function isEnforcementReadyProvider(
  provider: Parameters<typeof isUsableSsoProvider>[0] &
    Pick<AuthProvider, 'verifiedAt' | 'lastSuccessfulLoginAt'>,
): boolean {
  return Boolean(
    isUsableSsoProvider(provider) &&
      provider.verifiedAt &&
      provider.lastSuccessfulLoginAt,
  );
}
