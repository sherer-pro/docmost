import { NotificationType } from '../../core/notification/notification.constants';

export type NotificationLocale = 'en' | 'ru';

export function getNotificationLocale(
  locale?: string | null,
): NotificationLocale {
  return locale?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export function isRussianNotificationLocale(locale?: string | null): boolean {
  return getNotificationLocale(locale) === 'ru';
}

export function getNotificationTitle(
  type: string,
  actorName: string,
  pageTitle: string,
  locale?: string | null,
): string {
  const ru = isRussianNotificationLocale(locale);

  switch (type) {
    case NotificationType.COMMENT_USER_MENTION:
      return ru
        ? `${actorName} упоминает вас в комментарии`
        : `${actorName} mentioned you in a comment`;
    case NotificationType.COMMENT_CREATED:
      return ru
        ? `${actorName} комментирует страницу «${pageTitle}»`
        : `${actorName} commented on ${pageTitle}`;
    case NotificationType.COMMENT_REPLY:
      return ru
        ? `${actorName} отвечает на комментарий к странице «${pageTitle}»`
        : `${actorName} replied to a comment on ${pageTitle}`;
    case NotificationType.COMMENT_RESOLVED:
      return ru
        ? `${actorName} закрывает комментарий к странице «${pageTitle}»`
        : `${actorName} resolved a comment on ${pageTitle}`;
    case NotificationType.PAGE_USER_MENTION:
      return ru
        ? `${actorName} упоминает вас на странице «${pageTitle}»`
        : `${actorName} mentioned you in ${pageTitle}`;
    case NotificationType.PAGE_ASSIGNED:
      return ru
        ? `${actorName} назначает вас ответственным за страницу «${pageTitle}»`
        : `${actorName} assigned you to ${pageTitle}`;
    case NotificationType.PAGE_STAKEHOLDER_ADDED:
      return ru
        ? `${actorName} добавляет вас как заинтересованное лицо на страницу «${pageTitle}»`
        : `${actorName} added you as stakeholder to ${pageTitle}`;
    default:
      return ru
        ? `${actorName} обновляет страницу «${pageTitle}»`
        : `${actorName} updated ${pageTitle}`;
  }
}

export function getNotificationActionText(
  type: string,
  locale?: string | null,
): string {
  const ru = isRussianNotificationLocale(locale);

  switch (type) {
    case NotificationType.COMMENT_USER_MENTION:
      return ru
        ? 'упоминает вас в комментарии к'
        : 'mentioned you in a comment on';
    case NotificationType.COMMENT_CREATED:
      return ru ? 'комментирует' : 'commented on';
    case NotificationType.COMMENT_REPLY:
      return ru ? 'отвечает на комментарий к' : 'replied to your comment on';
    case NotificationType.COMMENT_RESOLVED:
      return ru ? 'закрывает комментарий к' : 'resolved a comment on';
    case NotificationType.PAGE_USER_MENTION:
      return ru ? 'упоминает вас на' : 'mentioned you on';
    case NotificationType.PAGE_ASSIGNED:
      return ru ? 'назначает вас ответственным за' : 'assigned you to';
    case NotificationType.PAGE_STAKEHOLDER_ADDED:
      return ru
        ? 'добавляет вас как заинтересованное лицо на'
        : 'added you as a stakeholder to';
    default:
      return ru ? 'обновляет' : 'updated';
  }
}

export function getDigestSubject(
  eventsCount: number,
  locale?: string | null,
): string {
  if (isRussianNotificationLocale(locale)) {
    return `У вас ${eventsCount} ${pluralizeRussian(eventsCount, [
      'обновление',
      'обновления',
      'обновлений',
    ])}`;
  }

  return `You have ${eventsCount} update${eventsCount === 1 ? '' : 's'}`;
}

export function getDigestIntervalLabel(
  frequency: string,
  locale?: string | null,
): string {
  const ru = isRussianNotificationLocale(locale);
  const labels: Record<string, [string, string]> = {
    '1h': ['hour', 'последний час'],
    '3h': ['3 hours', 'последние 3 часа'],
    '6h': ['6 hours', 'последние 6 часов'],
    '24h': ['24 hours', 'последние 24 часа'],
  };

  return labels[frequency]?.[ru ? 1 : 0] ?? (ru ? 'период' : 'period');
}

export function getDigestSummary(
  eventsCount: number,
  intervalLabel: string,
  locale?: string | null,
): string {
  if (isRussianNotificationLocale(locale)) {
    return `У вас ${eventsCount} ${pluralizeRussian(eventsCount, [
      'непрочитанное обновление',
      'непрочитанных обновления',
      'непрочитанных обновлений',
    ])} за ${intervalLabel}.`;
  }

  return `You have ${eventsCount} unread update${eventsCount === 1 ? '' : 's'} in the last ${intervalLabel}.`;
}

export function getAggregatedPushCopy(
  pageTitle: string,
  eventsCount: number,
  locale?: string | null,
): { title: string; body: string } {
  if (isRussianNotificationLocale(locale)) {
    return {
      title: `Обновления на странице «${pageTitle}»`,
      body: `${eventsCount} ${pluralizeRussian(eventsCount, [
        'событие',
        'события',
        'событий',
      ])} за этот период`,
    };
  }

  return {
    title: `Updates in ${pageTitle}`,
    body: `${eventsCount} event${eventsCount === 1 ? '' : 's'} in this period`,
  };
}

function pluralizeRussian(
  value: number,
  forms: [string, string, string],
): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) {
    return forms[2];
  }
  if (mod10 === 1) {
    return forms[0];
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return forms[1];
  }
  return forms[2];
}
