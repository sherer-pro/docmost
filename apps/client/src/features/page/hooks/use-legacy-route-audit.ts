import { usePostHog } from 'posthog-js/react';
import { useEffect } from 'react';

const LEGACY_ROUTE_AUDIT_KEY = 'docmost.legacyRouteAuditCounters';

/**
 * Временный аудит legacy-роутов.
 *
 * Что делает:
 * 1) увеличивает локальный счетчик в sessionStorage, чтобы можно было быстро
 *    посмотреть частоту срабатываний в рамках текущей сессии браузера;
 * 2) отправляет событие в PostHog, чтобы собрать агрегированную метрику
 *    на период наблюдения;
 * 3) пишет предупреждение в консоль для локальной диагностики.
 */
export function useLegacyRouteAudit(routeType: 'legacy_page' | 'legacy_database', legacyPath?: string) {
  const posthog = usePostHog();

  useEffect(() => {
    if (!legacyPath) {
      return;
    }

    try {
      const rawCounters = window.sessionStorage.getItem(LEGACY_ROUTE_AUDIT_KEY);
      const counters: Record<string, number> = rawCounters ? JSON.parse(rawCounters) : {};
      counters[routeType] = (counters[routeType] ?? 0) + 1;
      window.sessionStorage.setItem(LEGACY_ROUTE_AUDIT_KEY, JSON.stringify(counters));
    } catch {
      // Хранилище может быть недоступно в ограниченных окружениях браузера.
    }

    posthog?.capture('legacy_route_hit', {
      routeType,
      legacyPath,
    });

  }, [legacyPath, posthog, routeType]);
}
