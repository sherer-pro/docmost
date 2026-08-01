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
