import { SSO_PROVIDER } from "@/features/security/constants.ts";
import { getAppUrl } from "@/lib/config.ts";
import { sanitizeRelativeReturnTo } from "@/features/auth/utils/return-to.ts";

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
  spaceSlug?: string;
  returnTo?: string;
}): string {
  const { providerId, type } = opts;
  const domain = getAppUrl();
  const params = new URLSearchParams();
  if (opts.spaceSlug) params.set("spaceSlug", opts.spaceSlug);
  if (opts.returnTo) {
    params.set("returnTo", sanitizeRelativeReturnTo(opts.returnTo));
  }

  const query = params.size ? `?${params}` : "";
  return `${domain}/api/sso/${type}/${providerId}/login${query}`;
}

export function buildSsoStepUpUrl(opts: {
  providerId: string;
  type: SSO_PROVIDER;
  spaceSlug?: string;
  returnTo: string;
}): string {
  const domain = getAppUrl();
  const params = new URLSearchParams({
    returnTo: sanitizeRelativeReturnTo(opts.returnTo),
  });
  if (opts.spaceSlug) {
    params.set("spaceSlug", opts.spaceSlug);
  }
  return `${domain}/api/sso/${opts.type}/${opts.providerId}/step-up?${params}`;
}

export function buildSamlEntityId(providerId: string): string {
  const domain = getAppUrl();
  return `${domain}/api/sso/${SSO_PROVIDER.SAML}/${providerId}/login`;
}
