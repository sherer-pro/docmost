import { container, footer, h1, logo, main } from '../css/styles';
import {
  Body,
  Container,
  Head,
  Html,
  Row,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';

interface MailBodyProps {
  children: React.ReactNode;
  locale?: string;
}

export function MailBody({ children, locale }: MailBodyProps) {
  const isRussian = locale?.toLowerCase().startsWith('ru') ?? false;

  return (
    <Html lang={isRussian ? 'ru' : 'en'}>
      <Head />
      <Body style={main}>
        <MailHeader />
        <Container style={container}>{children}</Container>
        <MailFooter locale={locale} />
      </Body>
    </Html>
  );
}

export function MailHeader() {
  return (
    <Section style={logo}>
      {/* <Heading style={h1}>docmost</Heading> */}
    </Section>
  );
}

export function MailFooter({ locale }: { locale?: string }) {
  const isRussian = locale?.toLowerCase().startsWith('ru') ?? false;

  return (
    <Section style={footer}>
      <Row>
        <Text style={{ textAlign: 'center', color: '#706a7b' }}>
          © {new Date().getFullYear()} Docmost,{' '}
          {isRussian ? 'Все права защищены' : 'All Rights Reserved'} <br />
        </Text>
      </Row>
    </Section>
  );
}
