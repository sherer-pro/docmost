import api from '@/lib/api-client';

const PUSH_SUBSCRIPTION_ID_KEY = 'docmost.pushSubscriptionId';

interface PushSubscriptionCreateResponse {
  id: string;
}

/**
 * Compares applicationServerKey from an existing browser subscription
 * with the server's current VAPID key.
 *
 * This is required for WEB_PUSH_VAPID_* rotation on the backend:
 * old subscriptions created with the previous key may still exist
 * in the browser but no longer accept payloads signed by the new key.
 *
 * @param {PushSubscription | null} subscription - Current browser subscription.
 * @param {Uint8Array} expectedVapidKey - Current public VAPID key.
 * @returns {boolean} `true` when keys match and the subscription can be reused.
 */
function isSubscriptionBoundToCurrentVapidKey(
  subscription: PushSubscription | null,
  expectedVapidKey: Uint8Array,
): boolean {
  if (!subscription) {
    return false;
  }

  const currentKeyBuffer = subscription.options.applicationServerKey;
  if (!currentKeyBuffer) {
    return false;
  }

  const currentKey = new Uint8Array(currentKeyBuffer);
  if (currentKey.length !== expectedVapidKey.length) {
    return false;
  }

  for (let i = 0; i < currentKey.length; i += 1) {
    if (currentKey[i] !== expectedVapidKey[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Converts a VAPID public key from Base64URL format into Uint8Array,
 * which is required by the browser Push API.
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
 * Returns browser notification permission state.
 * Returns `unsupported` when the API is not available.
 */
export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || typeof window.Notification === 'undefined') {
    return 'unsupported';
  }

  return window.Notification.permission;
}

/**
 * Requests permission for push notifications.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  const currentPermission = getNotificationPermission();

  if (currentPermission === 'unsupported' || currentPermission === 'granted') {
    return currentPermission;
  }

  return window.Notification.requestPermission();
}

/**
 * Creates (or reuses) a browser push subscription,
 * sends it to the backend, and stores the subscription id locally.
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

  const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
  const existingSubscription = await registration.pushManager.getSubscription();

  /**
   * If a subscription exists but is tied to a previous VAPID key,
   * it must be recreated forcibly.
   * Otherwise push can silently fail after key rotation.
   */
  if (
    existingSubscription &&
    !isSubscriptionBoundToCurrentVapidKey(existingSubscription, applicationServerKey)
  ) {
    await existingSubscription.unsubscribe();
  }

  const browserSubscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
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
 * Unsubscribes the device from push notifications on backend and browser.
 */
export async function removePushSubscription(): Promise<void> {
  const subscriptionId = window.localStorage.getItem(PUSH_SUBSCRIPTION_ID_KEY);
  const registration =
    'serviceWorker' in navigator ? await navigator.serviceWorker.ready : null;
  const subscription = registration
    ? await registration.pushManager.getSubscription()
    : null;

  // Even if backend deletion fails, still try to unsubscribe the
  // browser so the device stops receiving push locally.
  let backendError: unknown;

  if (subscriptionId) {
    try {
      await api.delete(`/push/subscriptions/${subscriptionId}`);
    } catch (error) {
      backendError = error;
    }

    window.localStorage.removeItem(PUSH_SUBSCRIPTION_ID_KEY);
  } else if (subscription?.endpoint) {
    try {
      await api.delete('/push/subscriptions', {
        data: {
          endpoint: subscription.endpoint,
        },
      });
    } catch (error) {
      backendError = error;
    }
  }

  if (subscription) {
    await subscription.unsubscribe();
  }

  if (backendError) {
    throw backendError;
  }
}
