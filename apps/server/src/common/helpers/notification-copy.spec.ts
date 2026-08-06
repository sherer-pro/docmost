import { NotificationType } from '../../core/notification/notification.constants';
import {
  getAggregatedPushCopy,
  getDigestSummary,
  getDigestSubject,
  getNotificationTitle,
} from './notification-copy';

describe('notification copy localization', () => {
  it('uses English copy as the default', () => {
    expect(
      getNotificationTitle(NotificationType.COMMENT_REPLY, 'Alice', 'Roadmap'),
    ).toBe('Alice replied to a comment on Roadmap');
    expect(getDigestSubject(2, 'en-US')).toBe('You have 2 updates');
  });

  it('uses Russian copy for subjects and aggregated push payloads', () => {
    expect(
      getNotificationTitle(
        NotificationType.PAGE_ASSIGNED,
        'Алиса',
        'План',
        'ru-RU',
      ),
    ).toBe('Алиса назначает вас ответственным за страницу «План»');
    expect(getDigestSubject(5, 'ru-RU')).toBe('У вас 5 обновлений');
    expect(getDigestSummary(1, 'последний час', 'ru-RU')).toBe(
      'У вас 1 непрочитанное обновление за последний час.',
    );
    expect(getAggregatedPushCopy('План', 3, 'ru-RU')).toEqual({
      title: 'Обновления на странице «План»',
      body: '3 события за этот период',
    });
  });
});
