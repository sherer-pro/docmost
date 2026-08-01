import { SSO_PROVIDER } from "@/features/security/constants.ts";
import { getAppUrl } from "@/lib/config.ts";

export function buildCallbackUrl(opts: {
  providerId: string;
  type: SSO_PROVIDER;
}): string {
  const { providerId, type } = opts;
  const domain = getAppUrl();

  return `${domain}/api/sso/${type}/${providerId}/callback`;
}

export function buildSsoLoginUrl(opts: {
  providerId: string;
  type: SSO_PROVIDER;
}): string {
  const { providerId, type } = opts;
  const domain = getAppUrl();

  return `${domain}/api/sso/${type}/${providerId}/login`;
}

export function buildSamlEntityId(providerId: string): string {
  const domain = getAppUrl();
  return `${domain}/api/sso/${SSO_PROVIDER.SAML}/${providerId}/login`;
}
