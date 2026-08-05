import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  lookupTransclusion,
  lookupTransclusionForShare,
} from "@/features/transclusion/services/transclusion-api";
import type { TransclusionLookup } from "@/features/transclusion/types/transclusion.types";
import {
  TransclusionLookupContext,
  type ContextValue,
  type LookupKey,
  type Subscriber,
} from "./transclusion-lookup-context-value";

const RETRY_DELAYS_MS = [250, 1_000, 2_000, 5_000, 10_000, 30_000];

export function TransclusionLookupProvider({
  children,
  shareId,
}: {
  children: React.ReactNode;
  /**
   * When set, lookups go through the share-scoped public endpoint and are
   * gated by the share graph (source page must have its own share or inherit
   * one). Used by the public share viewer; left undefined in the authenticated
   * app, where personal permissions gate access.
   */
  shareId?: string;
}) {
  const subscribersRef = useRef(new Map<LookupKey, Subscriber[]>());
  const queueRef = useRef(new Set<LookupKey>());
  const tickRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read inside flush() via ref so changing share context doesn't churn the
  // memoized callbacks (and thus doesn't re-render every consumer).
  const shareIdRef = useRef<string | undefined>(shareId);
  shareIdRef.current = shareId;
  // Last looked-up value for each key. Re-subscribers (e.g. when the editor
  // remounts after switching from static to live) get this immediately
  // instead of triggering a duplicate fetch.
  const resultCacheRef = useRef(new Map<LookupKey, TransclusionLookup>());
  // Keys that are currently in flight in a batch request. A second subscribe
  // for the same key while the first request is pending is a no-op; the
  // subscriber is added to subscribersRef and will be notified when the
  // pending request completes.
  const inFlightRef = useRef(new Set<LookupKey>());
  const retryAttemptsRef = useRef(new Map<LookupKey, number>());
  const retryDueAtRef = useRef(new Map<LookupKey, number>());
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => void>(() => undefined);
  const armRetryTimerRef = useRef<() => void>(() => undefined);
  // Resolvers waiting on the next response for a key. Populated by refresh()
  // so callers can await the fetch round-trip; resolved on success and on
  // network error so the UI never hangs in a loading state.
  const pendingRef = useRef(new Map<LookupKey, Array<() => void>>());

  const armRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    for (const key of retryDueAtRef.current.keys()) {
      if (!subscribersRef.current.has(key)) {
        retryDueAtRef.current.delete(key);
        retryAttemptsRef.current.delete(key);
      }
    }

    const nextRetryAt = Math.min(...retryDueAtRef.current.values());

    if (!Number.isFinite(nextRetryAt)) {
      return;
    }

    retryTimerRef.current = setTimeout(
      () => {
        retryTimerRef.current = null;
        const now = Date.now();

        for (const [key, dueAt] of retryDueAtRef.current) {
          if (dueAt > now) {
            continue;
          }

          retryDueAtRef.current.delete(key);

          if (
            subscribersRef.current.has(key) &&
            !inFlightRef.current.has(key)
          ) {
            queueRef.current.add(key);
          }
        }

        if (queueRef.current.size > 0 && tickRef.current === null) {
          tickRef.current = setTimeout(() => flushRef.current(), 10);
        }

        armRetryTimerRef.current();
      },
      Math.max(0, nextRetryAt - Date.now()),
    );
  }, []);
  armRetryTimerRef.current = armRetryTimer;

  const flush = useCallback(async () => {
    tickRef.current = null;
    const keys = Array.from(queueRef.current);
    queueRef.current.clear();
    if (keys.length === 0) return;

    for (const k of keys) inFlightRef.current.add(k);

    const references = keys.map((k) => {
      const [sourcePageId, transclusionId] = k.split("::");
      return { sourcePageId, transclusionId };
    });

    const resolveWaiters = (key: LookupKey) => {
      const waiters = pendingRef.current.get(key);
      if (!waiters) return;
      pendingRef.current.delete(key);
      for (const w of waiters) w();
    };

    const clearRetry = (key: LookupKey) => {
      retryDueAtRef.current.delete(key);
      retryAttemptsRef.current.delete(key);
    };

    const scheduleRetry = (key: LookupKey) => {
      if (!subscribersRef.current.has(key)) {
        return;
      }

      const attempt = retryAttemptsRef.current.get(key) ?? 0;
      const delay =
        RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
      retryAttemptsRef.current.set(key, attempt + 1);
      retryDueAtRef.current.set(key, Date.now() + delay);
    };

    try {
      const activeShareId = shareIdRef.current;
      const { items } = activeShareId
        ? await lookupTransclusionForShare({
            shareId: activeShareId,
            references,
          })
        : await lookupTransclusion({ references });
      const returnedKeys = new Set<LookupKey>();
      for (const r of items) {
        if (!r) {
          continue;
        }

        const key = `${r.sourcePageId}::${r.transclusionId}`;
        returnedKeys.add(key);
        clearRetry(key);
        resultCacheRef.current.set(key, r);
        inFlightRef.current.delete(key);
        const subs = subscribersRef.current.get(key);
        if (subs) {
          for (const s of subs) s.setResult(r);
        }
        resolveWaiters(key);
      }
      for (const key of keys) {
        if (returnedKeys.has(key)) continue;
        inFlightRef.current.delete(key);
        resolveWaiters(key);
        scheduleRetry(key);
      }
    } catch {
      // Keep active subscribers pending and retry transient lookup failures.
      for (const k of keys) {
        inFlightRef.current.delete(k);
        resolveWaiters(k);
        scheduleRetry(k);
      }
    } finally {
      armRetryTimerRef.current();
    }
  }, []);
  flushRef.current = flush;

  const enqueue = useCallback(
    (key: LookupKey) => {
      queueRef.current.add(key);
      if (tickRef.current === null) {
        tickRef.current = setTimeout(flush, 10);
      }
    },
    [flush],
  );

  const subscribe = useCallback<ContextValue["subscribe"]>(
    (s) => {
      const list = subscribersRef.current.get(s.key) ?? [];
      list.push(s);
      subscribersRef.current.set(s.key, list);

      const cached = resultCacheRef.current.get(s.key);
      if (cached) {
        s.setResult(cached);
      } else if (!inFlightRef.current.has(s.key)) {
        enqueue(s.key);
      }

      return () => {
        const cur = subscribersRef.current.get(s.key) ?? [];
        const next = cur.filter((x) => x !== s);
        if (next.length === 0) {
          subscribersRef.current.delete(s.key);
          retryDueAtRef.current.delete(s.key);
          retryAttemptsRef.current.delete(s.key);
          armRetryTimerRef.current();
        } else subscribersRef.current.set(s.key, next);
      };
    },
    [enqueue],
  );

  const refresh = useCallback<ContextValue["refresh"]>(
    (key) =>
      new Promise<void>((resolve) => {
        inFlightRef.current.delete(key);
        retryDueAtRef.current.delete(key);
        retryAttemptsRef.current.delete(key);
        armRetryTimerRef.current();
        const waiters = pendingRef.current.get(key) ?? [];
        waiters.push(resolve);
        pendingRef.current.set(key, waiters);
        enqueue(key);
      }),
    [enqueue],
  );

  useEffect(
    () => () => {
      if (tickRef.current) clearTimeout(tickRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryDueAtRef.current.clear();
      retryAttemptsRef.current.clear();
      for (const waiters of pendingRef.current.values()) {
        for (const resolve of waiters) resolve();
      }
      pendingRef.current.clear();
    },
    [],
  );

  const value = useMemo<ContextValue>(
    () => ({ subscribe, refresh }),
    [subscribe, refresh],
  );

  return (
    <TransclusionLookupContext.Provider value={value}>
      {children}
    </TransclusionLookupContext.Provider>
  );
}
