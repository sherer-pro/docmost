import { Button, Link, Section, Text } from '@react-email/components';
import * as React from 'react';
import { button, content, paragraph } from '../css/styles';
import { MailBody } from '../partials/partials';
import {
  getDigestSummary,
  isRussianNotificationLocale,
} from '../../../common/helpers/notification-copy';

export interface NotificationDigestItem {
  actorName: string;
  actionText: string;
  pageTitle: string;
  pageUrl: string;
}

interface Props {
  entries: NotificationDigestItem[];
  totalCount: number;
  intervalLabel: string;
  workspaceUrl: string;
  locale?: string;
}

export const NotificationDigestEmail = ({
  entries,
  totalCount,
  intervalLabel,
  workspaceUrl,
  locale,
}: Props) => {
  const ru = isRussianNotificationLocale(locale);

  return (
    <MailBody locale={locale}>
      <Section style={content}>
        <Text style={paragraph}>{ru ? 'Здравствуйте!' : 'Hi there,'}</Text>
        <Text style={paragraph}>
          {getDigestSummary(totalCount, intervalLabel, locale)}
        </Text>
        {entries.map((entry, index) => (
          <Text key={`${entry.pageUrl}-${index}`} style={paragraph}>
            <strong>{entry.actorName}</strong> {entry.actionText}{' '}
            <Link href={entry.pageUrl}>
              <strong>{entry.pageTitle}</strong>
            </Link>
            .
          </Text>
        ))}
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
        <Button href={workspaceUrl} style={button}>
          {ru ? 'Открыть пространство' : 'Open workspace'}
        </Button>
      </Section>
    </MailBody>
  );
};

export default NotificationDigestEmail;
