import { Button, Link, Section, Text } from '@react-email/components';
import * as React from 'react';
import { button, content, paragraph } from '../css/styles';
import { MailBody } from '../partials/partials';

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
}

export const NotificationDigestEmail = ({
  entries,
  totalCount,
  intervalLabel,
  workspaceUrl,
}: Props) => {
  return (
    <MailBody>
      <Section style={content}>
        <Text style={paragraph}>Hi there,</Text>
        <Text style={paragraph}>
          You have {totalCount} unread update{totalCount === 1 ? '' : 's'} in the
          last {intervalLabel}.
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
          Open workspace
        </Button>
      </Section>
    </MailBody>
  );
};

export default NotificationDigestEmail;
