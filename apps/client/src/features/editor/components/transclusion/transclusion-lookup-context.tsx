import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useAtomValue } from "jotai";
import {
  lookupTransclusion,
  lookupTransclusionForShare,
} from "@/features/transclusion/services/transclusion-api";
import type { TransclusionLookup } from "@/features/transclusion/types/transclusion.types";
import { socketAtom } from "@/features/websocket/atoms/socket-atom";
import {
  TransclusionLookupContext,
  type ContextValue,
  type LookupKey,
  type Subscriber,
} from "./transclusion-lookup-context-value";

const RETRY_DELAYS_MS = [250, 1_000, 2_000, 5_000, 10_000, 30_000];
const LOOKUP_BATCH_SIZE = 50;
const INVALIDATION_COALESCE_MS = 50;

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
  const socket = useAtomValue(socketAtom);
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
  const invalidationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const requestVersionRef = useRef(new Map<LookupKey, number>());
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
    const requestVersions = new Map(
      keys.map((key) => [key, requestVersionRef.current.get(key) ?? 0]),
    );

    const isCurrentRequest = (key: LookupKey) =>
      requestVersions.get(key) === (requestVersionRef.current.get(key) ?? 0);

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

    const batches: LookupKey[][] = [];
    for (let index = 0; index < keys.length; index += LOOKUP_BATCH_SIZE) {
      batches.push(keys.slice(index, index + LOOKUP_BATCH_SIZE));
    }

    await Promise.all(
      batches.map(async (batchKeys) => {
        const references = batchKeys.map((key) => {
          const [sourcePageId, transclusionId] = key.split("::");
          return { sourcePageId, transclusionId };
        });
        const batchKeySet = new Set(batchKeys);

        try {
          const activeShareId = shareIdRef.current;
          const { items } = activeShareId
            ? await lookupTransclusionForShare({
                shareId: activeShareId,
                references,
              })
            : await lookupTransclusion({ references });
          const returnedKeys = new Set<LookupKey>();

          for (const result of items) {
            if (!result) continue;

            const key = `${result.sourcePageId}::${result.transclusionId}`;
            if (!batchKeySet.has(key)) continue;
            if (!isCurrentRequest(key)) continue;

            returnedKeys.add(key);
            clearRetry(key);
            resultCacheRef.current.set(key, result);
            inFlightRef.current.delete(key);
            const subscribers = subscribersRef.current.get(key);
            if (subscribers) {
              for (const subscriber of subscribers) {
                subscriber.setResult(result);
              }
            }
            resolveWaiters(key);
          }

          for (const key of batchKeys) {
            if (returnedKeys.has(key)) continue;
            if (!isCurrentRequest(key)) continue;
            inFlightRef.current.delete(key);
            resolveWaiters(key);
            scheduleRetry(key);
          }
        } catch {
          // Retry only the failed chunk; successful chunks stay cached.
          for (const key of batchKeys) {
            if (!isCurrentRequest(key)) continue;
            inFlightRef.current.delete(key);
            resolveWaiters(key);
            scheduleRetry(key);
          }
        }
      }),
    );

    armRetryTimerRef.current();
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
          requestVersionRef.current.delete(s.key);
          armRetryTimerRef.current();
        } else subscribersRef.current.set(s.key, next);
      };
    },
    [enqueue],
  );

  const refresh = useCallback<ContextValue["refresh"]>(
    (key) =>
      new Promise<void>((resolve) => {
        requestVersionRef.current.set(
          key,
          (requestVersionRef.current.get(key) ?? 0) + 1,
        );
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

  useEffect(() => {
    if (!socket || shareId) return;

    const refreshActiveLookups = () => {
      if (invalidationTimerRef.current) return;

      invalidationTimerRef.current = setTimeout(() => {
        invalidationTimerRef.current = null;
        for (const key of subscribersRef.current.keys()) {
          requestVersionRef.current.set(
            key,
            (requestVersionRef.current.get(key) ?? 0) + 1,
          );
          inFlightRef.current.delete(key);
          retryDueAtRef.current.delete(key);
          retryAttemptsRef.current.delete(key);
          enqueue(key);
        }
        armRetryTimerRef.current();
      }, INVALIDATION_COALESCE_MS);
    };

    socket.on("page-embed:invalidate", refreshActiveLookups);
    return () => {
      socket.off("page-embed:invalidate", refreshActiveLookups);
      if (invalidationTimerRef.current) {
        clearTimeout(invalidationTimerRef.current);
        invalidationTimerRef.current = null;
      }
    };
  }, [enqueue, shareId, socket]);

  useEffect(
    () => () => {
      if (tickRef.current) clearTimeout(tickRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (invalidationTimerRef.current) {
        clearTimeout(invalidationTimerRef.current);
      }
      retryDueAtRef.current.clear();
      retryAttemptsRef.current.clear();
      requestVersionRef.current.clear();
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
