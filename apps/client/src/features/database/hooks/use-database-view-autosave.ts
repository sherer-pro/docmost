import { useEffect, useRef, useState } from "react";
import type { IDatabaseView } from "../types/database.types";
import { getDatabaseViews } from "../services/database-service";

export function useDatabaseViewAutosave({
  view,
  draft,
  enabled,
  save,
  apply,
  manual = false,
  storageKey,
}: {
  view?: IDatabaseView;
  draft: { name: string; config: unknown };
  enabled: boolean;
  manual?: boolean;
  storageKey?: string;
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
  const [requestedSave, setRequestedSave] = useState(false);
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
  const hydrating = useRef(false);
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
      hydrating.current = true;
      if (manual && storageKey) {
        try {
          const local = JSON.parse(
            localStorage.getItem(`${storageKey}:${view.id}`) ?? "null",
          );
          if (local) {
            apply({
              ...view,
              ...local.draft,
              type: local.draft.config?.kanban ? "kanban" : "table",
            });
            if (local.revision !== view.revision) setStatus("conflict");
          }
        } catch {
          /* Unavailable or outdated local drafts do not prevent reading. */
        }
      }
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
    if (!manual || !storageKey || !view || applied.current?.id !== view.id)
      return;
    if (hydrating.current) {
      hydrating.current = false;
      return;
    }
    try {
      if (signature === applied.current.signature)
        localStorage.removeItem(`${storageKey}:${view.id}`);
      else
        localStorage.setItem(
          `${storageKey}:${view.id}`,
          JSON.stringify({ revision: applied.current.revision, draft }),
        );
    } catch {
      /* Storage quotas must not discard the in-memory draft. */
    }
  }, [signature, view?.id, storageKey, manual]);
  useEffect(() => {
    if (!view || !applied.current || !draft.name.trim()) return;
    if (!applied.current.signature) {
      applied.current.signature = signature;
      return;
    }
    if (
      !enabled ||
      (manual && !requestedSave) ||
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
        setRequestedSave(false);
        inFlight.current = false;
        if (mounted.current) setRetryVersion((v) => v + 1);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [
    view?.id,
    signature,
    enabled,
    status,
    retryVersion,
    manual,
    requestedSave,
  ]);
  return {
    status:
      manual &&
      applied.current &&
      signature !== applied.current.signature &&
      ["idle", "saved"].includes(status)
        ? "dirty"
        : status,
    save: () => setRequestedSave(true),
    retry: () => {
      setRequestedSave(true);
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
        if (storageKey) localStorage.removeItem(`${storageKey}:${current.id}`);
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
        setRequestedSave(true);
        setStatus("idle");
        setRetryVersion((v) => v + 1);
      } catch {
        setStatus("error");
      }
    },
  };
}
