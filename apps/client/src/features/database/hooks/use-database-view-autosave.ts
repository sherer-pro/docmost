import { useEffect, useRef, useState } from "react";
import type { IDatabaseView } from "../types/database.types";
import { getDatabaseViews } from "../services/database-service";

export function useDatabaseViewAutosave({
  view,
  draft,
  enabled,
  save,
  apply,
}: {
  view?: IDatabaseView;
  draft: { name: string; config: unknown };
  enabled: boolean;
  save: (payload: {
    viewId: string;
    payload: { name: string; config: unknown; expectedRevision?: number };
  }) => Promise<IDatabaseView>;
  apply: (view: IDatabaseView) => { name: string; config: unknown };
}) {
  const [status, setStatus] = useState<
    "idle" | "saving" | "saved" | "error" | "conflict"
  >("idle");
  const [retryVersion, setRetryVersion] = useState(0);
  const applied = useRef<{
    id: string;
    revision: number;
    signature: string;
  } | null>(null);
  const mounted = useRef(true);
  const latest = useRef({ view, draft, save, apply });
  latest.current = { view, draft, save, apply };
  const signature = JSON.stringify(draft);
  const inFlight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!view) {
      applied.current = null;
      setStatus("idle");
      return;
    }
    if (applied.current?.id !== view.id) {
      const initialized = apply(view);
      applied.current = {
        id: view.id,
        revision: view.revision ?? 1,
        signature: JSON.stringify(initialized),
      };
      setStatus("idle");
    }
  }, [view?.id]);
  useEffect(() => {
    if (
      !view ||
      !applied.current ||
      inFlight.current ||
      applied.current.id !== view.id ||
      applied.current.revision === view.revision
    )
      return;
    if (signature === applied.current.signature) {
      const initialized = apply(view);
      applied.current = {
        id: view.id,
        revision: view.revision ?? 1,
        signature: JSON.stringify(initialized),
      };
    } else setStatus("conflict");
  }, [view?.revision]);
  useEffect(() => {
    if (!view || !applied.current || !draft.name.trim()) return;
    if (!applied.current.signature) {
      applied.current.signature = signature;
      return;
    }
    if (
      !enabled ||
      signature === applied.current.signature ||
      status === "conflict" ||
      status === "error"
    )
      return;
    const timer = setTimeout(async () => {
      if (inFlight.current || latest.current.view?.id !== view.id) return;
      inFlight.current = true;
      setStatus("saving");
      try {
        const updated = await latest.current.save({
          viewId: view.id,
          payload: {
            ...latest.current.draft,
            expectedRevision: applied.current.revision,
          },
        });
        if (!mounted.current || latest.current.view?.id !== view.id) return;
        applied.current = {
          id: updated.id,
          revision: updated.revision ?? 1,
          signature,
        };
        setStatus("saved");
      } catch (error) {
        if (mounted.current && latest.current.view?.id === view.id)
          setStatus(
            (error as any)?.response?.status === 409 ? "conflict" : "error",
          );
      } finally {
        inFlight.current = false;
        if (mounted.current) setRetryVersion((v) => v + 1);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [view?.id, signature, enabled, status, retryVersion]);
  return {
    status,
    retry: () => {
      setStatus("idle");
      setRetryVersion((v) => v + 1);
    },
    reload: async () => {
      const current = latest.current.view;
      if (!current) return;
      try {
        const remote = (await getDatabaseViews(current.databaseId)).find(
          (item) => item.id === current.id,
        );
        if (!remote || latest.current.view?.id !== current.id) return;
        const initialized = apply(remote);
        applied.current = {
          id: remote.id,
          revision: remote.revision ?? 1,
          signature: JSON.stringify(initialized),
        };
        setStatus("idle");
      } catch {
        setStatus("error");
      }
    },
    overwrite: async () => {
      const current = latest.current.view;
      if (!current) return;
      try {
        const remote = (await getDatabaseViews(current.databaseId)).find(
          (item) => item.id === current.id,
        );
        if (
          !remote ||
          !applied.current ||
          latest.current.view?.id !== current.id
        )
          return;
        applied.current.revision = remote.revision ?? 1;
        setStatus("idle");
        setRetryVersion((v) => v + 1);
      } catch {
        setStatus("error");
      }
    },
  };
}
