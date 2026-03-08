import { Button, Container, Group, Text, Title } from '@mantine/core';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

interface LegacyRouteRemovedProps {
  canonicalFormat: string;
}

/**
 * Unified 410 screen for disabled legacy routes.
 *
 * All text and basic behavior (Helmet + CTA on `/home`) are placed in one place,
 * so that future wording and UX changes are made centrally.
 */
export function LegacyRouteRemoved({ canonicalFormat }: LegacyRouteRemovedProps) {
  const { t } = useTranslation();

  return (
    <>
      <Helmet>
        <title>{t('Legacy route removed')}</title>
      </Helmet>
      <Container py={80} size={'sm'}>
        <Title order={1} ta={'center'}>
          410
        </Title>
        <Text c={'dimmed'} ta={'center'} mt={'md'}>
          {t(
            'This legacy route is no longer supported. Please use canonical format: {{canonicalFormat}}',
            { canonicalFormat },
          )}
        </Text>
        <Group justify={'center'} mt={'xl'}>
          <Button component={Link} to={'/home'} variant={'light'}>
            {t('Go to home')}
          </Button>
        </Group>
      </Container>
    </>
  );
}
