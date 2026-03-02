import { Button, Container, Group, Text, Title } from '@mantine/core';
import { buildDatabaseUrl } from '@/features/page/page.utils.ts';
import { useLegacyRouteAudit } from '@/features/page/hooks/use-legacy-route-audit.ts';
import { useGetDatabaseQuery } from '@/features/database/queries/database-query.ts';
import { usePageQuery } from '@/features/page/queries/page-query.ts';
import { Helmet } from 'react-helmet-async';
import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

/**
 * Временный обработчик legacy URL формата `/s/:spaceSlug/databases/:databaseId`.
 *
 * Поведение:
 * - собирает аудит обращений к устаревшему роуту;
 * - пытается вычислить канонический URL `/s/:spaceSlug/db/:databaseSlug` и делает
 *   301-подобный redirect на клиенте (replace в истории);
 * - если база/страница не найдены, отображает явный 410-подобный экран
 *   (маршрут больше не поддерживается).
 */
export default function DatabaseLegacyRedirect() {
  const { databaseId, spaceSlug } = useParams();
  const navigate = useNavigate();

  useLegacyRouteAudit('legacy_database', window.location.pathname);

  const {
    data: database,
    isLoading: databaseIsLoading,
    isError: databaseIsError,
  } = useGetDatabaseQuery(databaseId);

  const {
    data: page,
    isLoading: pageIsLoading,
    isError: pageIsError,
  } = usePageQuery({ pageId: database?.pageId });

  useEffect(() => {
    if (!page || !spaceSlug) {
      return;
    }

    const canonicalUrl = buildDatabaseUrl(spaceSlug, page.slugId, page.title);
    navigate(canonicalUrl, { replace: true });
  }, [navigate, page, spaceSlug]);

  if (databaseIsLoading || pageIsLoading) {
    return null;
  }

  if (databaseIsError || pageIsError || !database?.pageId || !page) {
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
            Legacy database route was removed. Please use canonical format:
            {' /s/:spaceSlug/db/:databaseSlug'}
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
