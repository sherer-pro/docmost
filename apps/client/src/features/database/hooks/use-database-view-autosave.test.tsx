// @vitest-environment jsdom

import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeDatabaseViewState } from "@docmost/api-contract";
import type { IDatabaseView } from "../types/database.types";
import { useDatabaseViewAutosave } from "./use-database-view-autosave";

vi.mock("../services/database-service", () => ({ getDatabaseViews: vi.fn() }));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const storageKey = "test:manual-view-draft";
const view: IDatabaseView = {
  id: "view-1", databaseId: "database-1", workspaceId: "workspace-1",
  name: "Shared view", type: "table", revision: 3,
  config: { version: 3, columnWidths: { amount: 150 } },
  creatorId: null, createdAt: "2026-11-02T12:00:00Z",
  updatedAt: "2026-11-02T12:00:00Z", deletedAt: null,
};
const key = `${storageKey}:${view.id}`;
const project = (value: IDatabaseView) => ({
  name: value.name, config: normalizeDatabaseViewState(value.config),
});
type Draft = ReturnType<typeof project>;
type Save = Parameters<typeof useDatabaseViewAutosave>[0]["save"];
const mounted: { root: Root; container: HTMLElement }[] = [];

function mount(serverView: IDatabaseView, save: Save) {
  let state: ReturnType<typeof useDatabaseViewAutosave> & {
    draft: Draft; edit: (value: Draft) => void;
  };
  function Harness() {
    const [draft, edit] = useState(project(serverView));
    const autosave = useDatabaseViewAutosave({
      view: serverView, draft, enabled: true, manual: true, storageKey, save,
      apply: (next) => {
        const initialized = project(next);
        edit(initialized);
        return initialized;
      },
    });
    state = { ...autosave, draft, edit };
    return <output>{autosave.status}</output>;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => root.render(<Harness />));
  return {
    get current() { return state!; },
    unmount() {
      act(() => root.unmount());
      container.remove();
      mounted.splice(mounted.findIndex((entry) => entry.root === root), 1);
    },
  };
}

function changedDraft(width: number): Draft {
  return { ...project(view), config: {
    ...project(view).config, columnWidths: { amount: width },
  } };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.useRealTimers();
});

describe("manual view draft acknowledgement", () => {
  it("removes the acknowledged draft and reloads the saved server revision without conflict", async () => {
    const draft = changedDraft(300);
    const saved = { ...view, revision: 4, config: draft.config };
    const save = vi.fn<Save>().mockResolvedValue(saved);
    const hook = mount(view, save);
    act(() => hook.current.edit(draft));
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ revision: 3, draft });
    act(() => hook.current.save());
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(save).toHaveBeenCalledExactlyOnceWith({
      viewId: view.id, payload: { ...draft, expectedRevision: 3 },
    });
    expect(hook.current.status).toBe("saved");
    expect(localStorage.getItem(key)).toBeNull();
    hook.unmount();
    const reloaded = mount(saved, save);
    expect(reloaded.current.status).toBe("idle");
    expect(reloaded.current.draft).toEqual(draft);
  });

  it("keeps a newer draft and its base revision unchanged while an earlier save is pending", async () => {
    let acknowledge!: (value: IDatabaseView) => void;
    const save = vi.fn<Save>(() => new Promise((resolve) => { acknowledge = resolve; }));
    const hook = mount(view, save);
    const first = changedDraft(300);
    const newer = changedDraft(450);
    act(() => hook.current.edit(first));
    act(() => hook.current.save());
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(hook.current.status).toBe("saving");
    act(() => hook.current.edit(newer));
    const stored = localStorage.getItem(key);
    expect(JSON.parse(stored!)).toEqual({ revision: 3, draft: newer });
    const saved = { ...view, revision: 4, config: first.config };
    await act(async () => { acknowledge(saved); });
    expect(hook.current.status).toBe("dirty");
    expect(hook.current.draft).toEqual(newer);
    expect(localStorage.getItem(key)).toBe(stored);
    expect(save).toHaveBeenCalledTimes(1);
    hook.unmount();
    const reloaded = mount(saved, save);
    expect(reloaded.current.status).toBe("conflict");
    expect(reloaded.current.draft).toEqual(newer);
    expect(localStorage.getItem(key)).toBe(stored);
  });

  it("recognizes an old-revision draft already identical to the authoritative server after a fast reload", () => {
    const draft = changedDraft(300);
    localStorage.setItem(key, JSON.stringify({ revision: 3, draft }));
    const hook = mount({ ...view, revision: 4, config: draft.config }, vi.fn<Save>());
    expect(hook.current.status).toBe("idle");
    expect(hook.current.draft).toEqual(draft);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("does not delete another tab's different stored draft when this tab's save is acknowledged", async () => {
    let acknowledge!: (value: IDatabaseView) => void;
    const save = vi.fn<Save>(() => new Promise((resolve) => { acknowledge = resolve; }));
    const hook = mount(view, save);
    const draft = changedDraft(300);
    act(() => hook.current.edit(draft));
    act(() => hook.current.save());
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    const stored = JSON.stringify({ revision: 3, draft: changedDraft(450) });
    localStorage.setItem(key, stored);
    await act(async () => { acknowledge({ ...view, revision: 4, config: draft.config }); });
    expect(hook.current.status).toBe("saved");
    expect(hook.current.draft).toEqual(draft);
    expect(localStorage.getItem(key)).toBe(stored);
  });

  it("does not overwrite another tab's cache when this tab's pending save fails", async () => {
    let rejectSave!: (error: Error) => void;
    const save = vi.fn<Save>(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
    const hook = mount(view, save);
    act(() => hook.current.edit(changedDraft(300)));
    act(() => hook.current.save());
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    const stored = JSON.stringify({ revision: 3, draft: changedDraft(450) });
    localStorage.setItem(key, stored);
    await act(async () => { rejectSave(new Error("Synthetic offline")); });
    expect(hook.current.status).toBe("error");
    expect(localStorage.getItem(key)).toBe(stored);
  });

  it("does not overwrite another tab's cache on ACK when this tab also has a newer pending draft", async () => {
    let acknowledge!: (value: IDatabaseView) => void;
    const save = vi.fn<Save>(() => new Promise((resolve) => { acknowledge = resolve; }));
    const hook = mount(view, save);
    const first = changedDraft(300);
    const newer = changedDraft(450);
    act(() => hook.current.edit(first));
    act(() => hook.current.save());
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    act(() => hook.current.edit(newer));
    const stored = JSON.stringify({ revision: 3, draft: changedDraft(600) });
    localStorage.setItem(key, stored);
    await act(async () => { acknowledge({ ...view, revision: 4, config: first.config }); });
    expect(hook.current.status).toBe("dirty");
    expect(hook.current.draft).toEqual(newer);
    expect(localStorage.getItem(key)).toBe(stored);
  });

  it("retains the conflict and local content when an old-revision draft differs from the server", () => {
    const draft = changedDraft(450);
    const stored = JSON.stringify({ revision: 3, draft });
    localStorage.setItem(key, stored);
    const hook = mount({ ...view, revision: 4 }, vi.fn<Save>());
    expect(hook.current.status).toBe("conflict");
    expect(hook.current.draft).toEqual(draft);
    expect(localStorage.getItem(key)).toBe(stored);
  });

  it("retains the recoverable draft when saving fails", async () => {
    const save = vi.fn<Save>().mockRejectedValue(new Error("Synthetic offline"));
    const hook = mount(view, save);
    const draft = changedDraft(300);
    act(() => hook.current.edit(draft));
    const stored = localStorage.getItem(key);
    act(() => hook.current.save());
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(hook.current.status).toBe("error");
    expect(localStorage.getItem(key)).toBe(stored);
  });
});
