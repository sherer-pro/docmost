import { useParams } from 'react-router-dom';
import { usePageQuery } from '@/features/page/queries/page-query';
import { buildPageUrl } from '@/features/page/page.utils.ts';
import { extractPageSlugId } from '@/lib';
import { LegacyRouteRemoved } from '@/pages/common/legacy-route-removed.tsx';
import { useLegacyCanonicalRedirect } from '@/features/page/hooks/use-legacy-canonical-redirect.ts';

/**
 * Временный обработчик legacy URL формата `/p/:pageSlug`.
 *
 * Компонент оставляет у себя только специфичную логику:
 * - получение page по legacy slug;
 * - построение канонического URL страницы.
 *
 * Вся общая инфраструктура (аудит, redirect, 410-экран) вынесена в переиспользуемые сущности.
 */
export default function PageRedirect() {
  const { pageSlug } = useParams();

  const {
    data: page,
    isLoading: pageIsLoading,
    isError,
  } = usePageQuery({ pageId: extractPageSlugId(pageSlug) });

  const canonicalUrl = page ? buildPageUrl(page.space.slug, page.slugId, page.title) : undefined;

  const { isRedirectingOrLoading } = useLegacyCanonicalRedirect({
    routeType: 'legacy_page',
    legacyPath: window.location.pathname,
    canonicalUrl,
    isLoading: pageIsLoading,
  });

  if (isRedirectingOrLoading) {
    return null;
  }

  if (isError || !page) {
    return <LegacyRouteRemoved canonicalFormat={'/s/:spaceSlug/p/:pageSlug'} />;
  }

  return null;
}
