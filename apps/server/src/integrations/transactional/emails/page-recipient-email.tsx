import { Section, Text, Button } from '@react-email/components';
import * as React from 'react';
import { button, content, paragraph } from '../css/styles';
import { MailBody } from '../partials/partials';
import { isRussianNotificationLocale } from '../../../common/helpers/notification-copy';

interface Props {
  actorName: string;
  pageTitle: string;
  pageUrl: string;
  actionText: string;
  locale?: string;
}

export const PageRecipientEmail = ({
  actorName,
  pageTitle,
  pageUrl,
  actionText,
  locale,
}: Props) => {
  const ru = isRussianNotificationLocale(locale);

  return (
    <MailBody locale={locale}>
      <Section style={content}>
        <Text style={paragraph}>{ru ? 'Здравствуйте!' : 'Hi there,'}</Text>
        <Text style={paragraph}>
          <strong>{actorName}</strong> {actionText} <strong>{pageTitle}</strong>
          .
        </Text>
      </Section>
      <Section
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          paddingLeft: '15px',
          paddingBottom: '15px',
        }}
      >
        <Button href={pageUrl} style={button}>
          {ru ? 'Открыть' : 'View'}
        </Button>
      </Section>
    </MailBody>
  );
};

export default PageRecipientEmail;
