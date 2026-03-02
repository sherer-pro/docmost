import { Button, Container, Group, Text, Title } from '@mantine/core';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useEffect } from 'react';
import { usePageQuery } from '@/features/page/queries/page-query';
import { buildPageUrl } from '@/features/page/page.utils.ts';
import { extractPageSlugId } from '@/lib';
import { Helmet } from 'react-helmet-async';
import { useLegacyRouteAudit } from '@/features/page/hooks/use-legacy-route-audit.ts';

/**
 * Временный обработчик legacy URL формата `/p/:pageSlug`.
 *
 * Если страница найдена, выполняет redirect в canonical URL
 * `/s/:spaceSlug/p/:pageSlug`.
 * Если страница не найдена, отображает явный 410-подобный экран,
 * чтобы остаточные обращения к legacy-формату были заметны.
 */
export default function PageRedirect() {
  const { pageSlug } = useParams();
  useLegacyRouteAudit('legacy_page', window.location.pathname);

  const {
    data: page,
    isLoading: pageIsLoading,
    isError,
  } = usePageQuery({ pageId: extractPageSlugId(pageSlug) });
  const navigate = useNavigate();

  useEffect(() => {
    if (page) {
      const pageUrl = buildPageUrl(page.space.slug, page.slugId, page.title);
      navigate(pageUrl, { replace: true });
    }
  }, [navigate, page]);

  if (pageIsLoading) {
    return null;
  }

  if (isError || !page) {
    return (
      <>
        <Helmet>
          <title>410 - Legacy route removed</title>
        </Helmet>
        <Container py={80} size={'sm'}>
          <Title order={1} ta={'center'}>
            410
          </Title>
          <Text c={'dimmed'} ta={'center'} mt={'md'}>
            Legacy page route was removed. Please use canonical format: {'/s/:spaceSlug/p/:pageSlug'}
          </Text>
          <Group justify={'center'} mt={'xl'}>
            <Button component={Link} to={'/home'} variant={'light'}>
              Go to home
            </Button>
          </Group>
        </Container>
      </>
    );
  }

  return null;
}
