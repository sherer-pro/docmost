export interface MailMessage {
  from?: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  template?: any;
  notificationId?: string;
  notificationIds?: string[];
  notificationUserId?: string;
  notificationDeliveryMode?: 'immediate' | 'digest';
  notificationFrequency?: string;
}
