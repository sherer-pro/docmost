import { Button, Container, Group, Text, Title } from '@mantine/core';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';

interface LegacyRouteRemovedProps {
  canonicalFormat: string;
}

/**
 * Унифицированный 410-экран для отключенных legacy-маршрутов.
 *
 * Весь текст и базовое поведение (Helmet + CTA на `/home`) вынесены в одно место,
 * чтобы будущие правки формулировок и UX делались централизованно.
 */
export function LegacyRouteRemoved({ canonicalFormat }: LegacyRouteRemovedProps) {
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
          This legacy route is no longer supported. Please use canonical format: {canonicalFormat}
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
