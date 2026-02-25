import api from '@/lib/api-client';

const PUSH_SUBSCRIPTION_ID_KEY = 'docmost.pushSubscriptionId';

interface PushSubscriptionCreateResponse {
  id: string;
}

/**
 * Преобразует VAPID public key из Base64URL-формата в Uint8Array,
 * который требуется браузерному Push API.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

/**
 * Возвращает браузерное разрешение на уведомления.
 * Если API не поддерживается, возвращает `unsupported`.
 */
export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || typeof window.Notification === 'undefined') {
    return 'unsupported';
  }

  return window.Notification.permission;
}

/**
 * Запрашивает разрешение на push-уведомления.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  const currentPermission = getNotificationPermission();

  if (currentPermission === 'unsupported' || currentPermission === 'granted') {
    return currentPermission;
  }

  return window.Notification.requestPermission();
}

/**
 * Создаёт (или переиспользует) браузерную push-подписку,
 * отправляет её на backend и сохраняет идентификатор подписки локально.
 */
export async function createPushSubscription(): Promise<string> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service Worker is not supported');
  }

  const registration = await navigator.serviceWorker.ready;
  const vapidResponse = await api.get<{ publicKey: string }>('/push/vapid-public-key');
  const vapidPublicKey = vapidResponse.data.publicKey;

  if (!vapidPublicKey) {
    throw new Error('Missing WEB_PUSH_VAPID_PUBLIC_KEY on server');
  }

  const existingSubscription = await registration.pushManager.getSubscription();
  const browserSubscription =
    existingSubscription ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }));

  const subscriptionJson = browserSubscription.toJSON();

  if (!subscriptionJson.endpoint || !subscriptionJson.keys?.p256dh || !subscriptionJson.keys?.auth) {
    throw new Error('Invalid push subscription payload');
  }

  const response = await api.post<PushSubscriptionCreateResponse>('/push/subscriptions', {
    endpoint: subscriptionJson.endpoint,
    p256dh: subscriptionJson.keys.p256dh,
    auth: subscriptionJson.keys.auth,
    userAgent: window.navigator.userAgent,
  });

  window.localStorage.setItem(PUSH_SUBSCRIPTION_ID_KEY, response.data.id);

  return response.data.id;
}

/**
 * Отписывает устройство от push-уведомлений на backend и в браузере.
 */
export async function removePushSubscription(): Promise<void> {
  const subscriptionId = window.localStorage.getItem(PUSH_SUBSCRIPTION_ID_KEY);
  const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.ready : null;
  const subscription = registration
    ? await registration.pushManager.getSubscription()
    : null;

  // Даже если удаление на backend не удалось, всё равно пытаемся отписать
  // браузер, чтобы устройство перестало получать push локально.
  let backendError: unknown;

  if (subscriptionId) {
    try {
      await api.delete(`/push/subscriptions/${subscriptionId}`);
    } catch (error) {
      backendError = error;
    }

    window.localStorage.removeItem(PUSH_SUBSCRIPTION_ID_KEY);
  }

  if (subscription) {
    await subscription.unsubscribe();
  }

  if (backendError) {
    throw backendError;
  }
}
