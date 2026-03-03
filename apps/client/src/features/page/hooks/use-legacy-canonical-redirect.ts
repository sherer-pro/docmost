import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLegacyRouteAudit } from '@/features/page/hooks/use-legacy-route-audit.ts';

interface UseLegacyCanonicalRedirectParams {
  routeType: 'legacy_page' | 'legacy_database';
  legacyPath: string;
  canonicalUrl?: string;
  isLoading: boolean;
}

/**
 * General framework for legacy-redirect scripts.
 *
 * The hook centralizes:
 * - audit of calls to an outdated route;
 * - replace-redirect to canonical URL upon successful resolution;
 * - a single state “while loading or already redirecting” so that the screen does not blink.
 */
export function useLegacyCanonicalRedirect({
  routeType,
  legacyPath,
  canonicalUrl,
  isLoading,
}: UseLegacyCanonicalRedirectParams) {
  const navigate = useNavigate();

  useLegacyRouteAudit(routeType, legacyPath);

  useEffect(() => {
    if (!canonicalUrl) {
      return;
    }

    navigate(canonicalUrl, { replace: true });
  }, [canonicalUrl, navigate]);

  return {
    isRedirectingOrLoading: isLoading || Boolean(canonicalUrl),
  };
}
