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
 * Общая обвязка для legacy-redirect сценариев.
 *
 * Хук централизует:
 * - аудит обращений к устаревшему маршруту;
 * - replace-redirect в канонический URL при успешном разрешении;
 * - единое состояние «пока грузим или уже редиректим», чтобы экран не мигал.
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
