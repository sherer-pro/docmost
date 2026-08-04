import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { lookupPageEmbeds } from "@/features/page-template/services/page-template-api";
import type { PageEmbedLookup } from "@/features/page-template/types/page-template.types";
import { useAtomValue } from "jotai";
import { socketAtom } from "@/features/websocket/atoms/socket-atom";

type Subscriber = (result: PageEmbedLookup | undefined) => void;
type ContextValue = {
  subscribe: (sourcePageId: string, subscriber: Subscriber) => () => void;
  refresh: (sourcePageId: string) => Promise<void>;
  maxDepth: number | null;
};

const PageEmbedLookupContext = createContext<ContextValue | null>(null);
export const PageEmbedDepthContext = createContext<{
  depth: number;
  visited: Set<string>;
}>({ depth: 0, visited: new Set() });

export function PageEmbedLookupProvider({
  children,
  shareId,
  referencePageId,
}: {
  children: React.ReactNode;
  shareId?: string;
  referencePageId?: string;
}) {
  const subscribers = useRef(new Map<string, Set<Subscriber>>());
  const cache = useRef(new Map<string, PageEmbedLookup>());
  const queued = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef({ shareId, referencePageId });
  const generation = useRef(0);
  const [maxDepth, setMaxDepth] = useState<number | null>(null);
  const socket = useAtomValue(socketAtom);

  const cacheKey = useCallback(
    (sourcePageId: string) =>
      `${active.current.shareId ?? ""}:${active.current.referencePageId ?? ""}:${sourcePageId}`,
    [],
  );

  const flush = useCallback(async () => {
    timer.current = null;
    const sourcePageIds = Array.from(queued.current).slice(0, 50);
    sourcePageIds.forEach((id) => queued.current.delete(id));
    if (sourcePageIds.length === 0) return;
    const requestGeneration = generation.current;
    const requestContext = { ...active.current };
    try {
      const response = await lookupPageEmbeds({
        sourcePageIds,
        ...requestContext,
      });
      if (requestGeneration !== generation.current) return;
      setMaxDepth(response.maxDepth);
      response.items.forEach((result) => {
        // Replacing the map entry, including unavailable states, ensures no
        // previous title/content remains reachable after access revocation.
        cache.current.set(cacheKey(result.sourcePageId), result);
        subscribers.current
          .get(result.sourcePageId)
          ?.forEach((subscriber) => subscriber(result));
      });
    } catch {
      if (requestGeneration !== generation.current) return;
      sourcePageIds.forEach((sourcePageId) => {
        cache.current.delete(cacheKey(sourcePageId));
        subscribers.current
          .get(sourcePageId)
          ?.forEach((subscriber) => subscriber(undefined));
      });
    } finally {
      if (queued.current.size > 0 && timer.current === null) {
        timer.current = setTimeout(flush, 10);
      }
    }
  }, [cacheKey]);

  const enqueue = useCallback(
    (sourcePageId: string) => {
      queued.current.add(sourcePageId);
      if (timer.current === null) timer.current = setTimeout(flush, 10);
    },
    [flush],
  );

  const subscribe = useCallback<ContextValue["subscribe"]>(
    (sourcePageId, subscriber) => {
      const set = subscribers.current.get(sourcePageId) ?? new Set();
      set.add(subscriber);
      subscribers.current.set(sourcePageId, set);
      const key = cacheKey(sourcePageId);
      subscriber(cache.current.get(key));
      if (!cache.current.has(key)) enqueue(sourcePageId);
      return () => {
        const current = subscribers.current.get(sourcePageId);
        current?.delete(subscriber);
        if (current?.size === 0) subscribers.current.delete(sourcePageId);
      };
    },
    [cacheKey, enqueue],
  );

  const refresh = useCallback<ContextValue["refresh"]>(
    async (sourcePageId) => {
      const requestGeneration = generation.current;
      cache.current.delete(cacheKey(sourcePageId));
      subscribers.current
        .get(sourcePageId)
        ?.forEach((subscriber) => subscriber(undefined));
      try {
        const response = await lookupPageEmbeds({
          sourcePageIds: [sourcePageId],
          ...active.current,
        });
        if (requestGeneration !== generation.current) return;
        setMaxDepth(response.maxDepth);
        const result = response.items[0];
        if (result) {
          cache.current.set(cacheKey(sourcePageId), result);
          subscribers.current
            .get(sourcePageId)
            ?.forEach((subscriber) => subscriber(result));
        }
      } catch {
        if (requestGeneration !== generation.current) return;
        cache.current.delete(cacheKey(sourcePageId));
        subscribers.current
          .get(sourcePageId)
          ?.forEach((subscriber) => subscriber(undefined));
      }
    },
    [cacheKey],
  );

  const invalidateAll = useCallback(() => {
    generation.current += 1;
    cache.current.clear();
    queued.current.clear();
    setMaxDepth(null);
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    subscribers.current.forEach((listeners, sourcePageId) => {
      listeners.forEach((subscriber) => subscriber(undefined));
      enqueue(sourcePageId);
    });
  }, [enqueue]);

  useEffect(() => {
    active.current = { shareId, referencePageId };
    invalidateAll();
  }, [invalidateAll, referencePageId, shareId]);

  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState !== "visible") return;
      invalidateAll();
    };
    window.addEventListener("focus", refreshVisible);
    const poll = shareId ? window.setInterval(refreshVisible, 30_000) : null;
    return () => {
      window.removeEventListener("focus", refreshVisible);
      if (poll) window.clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [invalidateAll, shareId]);

  useEffect(() => {
    if (!socket || shareId) return;
    const invalidate = () => invalidateAll();
    socket.on("page-embed:invalidate", invalidate);
    socket.on("connect", invalidate);
    return () => {
      socket.off("page-embed:invalidate", invalidate);
      socket.off("connect", invalidate);
    };
  }, [invalidateAll, shareId, socket]);

  const value = useMemo(
    () => ({ subscribe, refresh, maxDepth }),
    [maxDepth, refresh, subscribe],
  );
  return (
    <PageEmbedLookupContext.Provider value={value}>
      {children}
    </PageEmbedLookupContext.Provider>
  );
}

export function usePageEmbedLookup(sourcePageId?: string | null) {
  const context = useContext(PageEmbedLookupContext);
  const subscribe = context?.subscribe;
  const refresh = context?.refresh;
  const [result, setResult] = useState<PageEmbedLookup>();
  useEffect(() => {
    setResult(undefined);
    if (!subscribe || !sourcePageId) return;
    return subscribe(sourcePageId, setResult);
  }, [sourcePageId, subscribe]);
  return {
    result,
    maxDepth: context?.maxDepth ?? null,
    refresh: () =>
      sourcePageId && refresh ? refresh(sourcePageId) : Promise.resolve(),
  };
}
