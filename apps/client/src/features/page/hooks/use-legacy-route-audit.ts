import { usePostHog } from 'posthog-js/react';
import { useEffect } from 'react';

const LEGACY_ROUTE_AUDIT_KEY = 'docmost.legacyRouteAuditCounters';

/**
 * Temporary audit of legacy routes.
 *
 * What it does:
 * 1) increases the local counter in sessionStorage so that you can quickly
 * see the frequency of responses within the current browser session;
 * 2) sends an event to PostHog to collect the aggregated metric
 * for the observation period;
 * 3) writes a warning to the console for local diagnostics.
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
      // Storage may not be available in restricted browser environments.
    }

    posthog?.capture('legacy_route_hit', {
      routeType,
      legacyPath,
    });

  }, [legacyPath, posthog, routeType]);
}
