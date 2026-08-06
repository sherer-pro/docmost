import { Section, Text, Button } from '@react-email/components';
import * as React from 'react';
import { button, content, paragraph } from '../css/styles';
import { MailBody } from '../partials/partials';
import { isRussianNotificationLocale } from '../../../common/helpers/notification-copy';

interface Props {
  actorName: string;
  pageTitle: string;
  pageUrl: string;
  locale?: string;
  isReply?: boolean;
}

export const CommentCreateEmail = ({
  actorName,
  pageTitle,
  pageUrl,
  locale,
  isReply = false,
}: Props) => {
  const ru = isRussianNotificationLocale(locale);
  const actionText = isReply
    ? ru
      ? 'отвечает на комментарий к странице'
      : 'replied to a comment on'
    : ru
      ? 'комментирует страницу'
      : 'commented on';

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

export default CommentCreateEmail;
