// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiContextPicker } from "./ai-context-picker";
import type {
  AiChatFile,
  AiContextSource,
  AiDescendantSelection,
  AiPageAttachment,
} from "@/features/ai/types/ai.types.ts";

vi.mock("@mantine/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mantine/hooks")>()),
  useDebouncedValue: <T,>(value: T) => [value],
  useMediaQuery: () => false,
}));

const searchQuery: {
  data: { pages: Array<{ items: AiContextSource[] }> };
  isLoading: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: ReturnType<typeof vi.fn>;
} = {
  data: { pages: [{ items: [] }] },
  isLoading: false,
  isError: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
};

const descendantsQuery: {
  data: { items: AiContextSource[] };
  isLoading: boolean;
  isError: boolean;
} = {
  data: { items: [] },
  isLoading: false,
  isError: false,
};

vi.mock("@/features/ai/queries/ai-query.ts", () => ({
  useAiContextSourcesQuery: () => searchQuery,
  useAiContextDescendantsQuery: () => descendantsQuery,
}));

const translations: Record<string, string> = {
  "ai.context.managerTitle": "Context",
  "ai.context.managerDescription": "Choose context",
  "ai.context.autosaveHint": "Saved automatically",
  "ai.context.currentDocument": "Current document",
  "ai.context.currentDocumentDescription": "Current document description",
  "ai.context.addedDocuments": "Added documents",
  "ai.context.addedDocumentsDescription": "Added documents description",
  "ai.context.noAddedDocuments": "No additional sources",
  "ai.context.noAddedDocumentsDescription": "Add more sources",
  "ai.context.addFromSpace": "Add from space",
  "ai.context.filesAndAttachments": "Files and attachments",
  "ai.context.filesDescription": "Files description",
  "ai.context.uploadPrivateFiles": "Upload private files",
  "ai.context.noFiles": "No files available",
  "ai.context.noFilesDescription": "Upload a file",
  "ai.context.privateFiles": "Private files",
  "ai.context.currentDocumentAttachments": "Current document attachments",
  "ai.context.searchTitle": "Search space",
  "ai.context.searchPlaceholder": "Search",
  "ai.context.spaceRoot": "Space root",
  "ai.context.chooseScopeTitle": "Choose scope",
  "ai.context.chooseScopeDescription": "Choose page tree scope",
  "ai.context.scope.none": "Document only",
  "ai.context.scope.all": "All child pages",
  "ai.context.scope.selected": "Selected child pages",
  "ai.context.scopeDescription.none": "Only this document",
  "ai.context.scopeDescription.all": "All descendants",
  "ai.context.scopeDescription.selected": "Specific descendants",
  "ai.context.sourceExcluded": "Excluded by the space AI policy",
  "ai.context.selectDescendantsHint": "Select individual pages",
  "ai.context.noChildPages": "No child pages",
  "ai.context.applySelection": "Apply selection",
  "ai.context.back": "Back",
  "ai.context.saving": "Saving",
  "ai.ux.contextSaveFailed": "Context save failed",
  "ai.tryAgain": "Try again",
  "ai.deleteFile": "Delete file",
  "ai.fileStatus.processing": "Processing",
  Close: "Close",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === "ai.context.trigger") return `Context · ${values?.count}`;
      if (key === "ai.context.triggerLabel") {
        return `Message context: ${values?.count} selected`;
      }
      if (key === "ai.context.resolvedCounter") {
        return `${values?.count}/${values?.limit} sources`;
      }
      if (key === "ai.context.privateFilesCounter") {
        return `Private files ${values?.count}/${values?.limit}`;
      }
      if (key === "ai.context.attachmentsCounter") {
        return `Attachments ${values?.count}/${values?.limit}`;
      }
      if (key === "ai.context.selectDescendantsTitle") {
        return `Choose pages under ${values?.title}`;
      }
      if (key === "ai.context.selectedCount") {
        return `${values?.count} selected`;
      }
      return translations[key] ?? key;
    },
  }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function source(overrides: Partial<AiContextSource> = {}): AiContextSource {
  return {
    id: "page:source",
    sourceType: "page",
    sourceId: "source",
    pageId: "source",
    title: "Source page",
    icon: null,
    breadcrumbs: [],
    url: null,
    position: 0,
    available: true,
    hasChildren: false,
    descendants: { mode: "none", pageIds: [] },
    ...overrides,
  };
}

function chatFile(overrides: Partial<AiChatFile> = {}): AiChatFile {
  return {
    id: "file",
    conversationId: "conversation",
    userId: "user",
    workspaceId: "workspace",
    spaceId: "space",
    name: "brief.pdf",
    mimeType: "application/pdf",
    size: 1024,
    status: "ready",
    error: null,
    uploadBatchId: null,
    uploadedAt: "2026-08-02T00:00:00.000Z",
    storageDeletedAt: null,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

function pageAttachment(
  overrides: Partial<AiPageAttachment> = {},
): AiPageAttachment {
  return {
    id: "attachment",
    fileName: "wireframe.png",
    mimeType: "image/png",
    size: 2048,
    ...overrides,
  };
}

function createProps(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: "conversation",
    documentPageId: "document",
    documentTitle: "Design brief",
    currentDocumentAvailable: true,
    includeCurrentDocument: true,
    currentDocumentDescendants: {
      mode: "none",
      pageIds: [],
    } as AiDescendantSelection,
    sources: [] as AiContextSource[],
    resolvedSourceCount: 1,
    limits: { manualRoots: 10, resolvedSources: 50 },
    fileIds: [] as string[],
    attachmentIds: [] as string[],
    chatFiles: [],
    pageAttachments: [],
    loadingFiles: false,
    saving: false,
    saveFailed: false,
    opened: false,
    onOpenedChange: vi.fn(),
    onToggleCurrentDocument: vi.fn().mockResolvedValue(undefined),
    onSetCurrentDocumentDescendants: vi.fn().mockResolvedValue(undefined),
    onAddSource: vi.fn().mockResolvedValue(undefined),
    onRemoveSource: vi.fn().mockResolvedValue(undefined),
    onSetSourceDescendants: vi.fn().mockResolvedValue(undefined),
    onToggleFile: vi.fn().mockResolvedValue(undefined),
    onToggleAttachment: vi.fn().mockResolvedValue(undefined),
    onUpload: vi.fn().mockResolvedValue(undefined),
    onDeleteFile: vi.fn(),
    onRetrySave: vi.fn().mockResolvedValue(undefined),
    onPrepareConversation: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("AiContextPicker UI", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container?.remove();
    document.querySelectorAll("[data-portal]").forEach((node) => node.remove());
    searchQuery.data = { pages: [{ items: [] }] };
    descendantsQuery.data = { items: [] };
    root = null;
    container = null;
    vi.clearAllMocks();
  });

  function renderPicker(props: ReturnType<typeof createProps>) {
    container = document.createElement("div");
    container.id = "root";
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <MantineProvider>
          <AiContextPicker {...props} />
        </MantineProvider>,
      );
    });
  }

  it("shows an explicit root-level count and opens through the controlled callback", () => {
    const props = createProps({
      sources: [source()],
      fileIds: ["file"],
      attachmentIds: ["attachment"],
    });
    renderPicker(props);

    const trigger = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Message context: 4 selected"]',
    );
    expect(trigger?.textContent).toContain("Context · 4");

    act(() => trigger?.click());
    expect(props.onOpenedChange).toHaveBeenCalledWith(true);
  });

  it("renders the overview as one manager with compact empty states", () => {
    renderPicker(createProps({ opened: true }));

    expect(document.body.textContent).toContain("Choose context");
    expect(document.body.textContent).toContain("Current document");
    expect(document.body.textContent).toContain("No additional sources");
    expect(document.body.textContent).toContain("No files available");
    expect(document.body.textContent).toContain("1/50 sources");
  });

  it("navigates to search inside the same modal", async () => {
    const props = createProps({ opened: true });
    renderPicker(props);
    const addButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Add from space"),
    );

    await act(async () => {
      addButton?.click();
      await Promise.resolve();
    });

    expect(props.onPrepareConversation).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("Search space");
    expect(
      document.body.querySelector('input[placeholder="Search"]'),
    ).not.toBeNull();
  });

  it("shows an unavailable search result and its blocking reason inline", async () => {
    searchQuery.data = {
      pages: [
        {
          items: [
            source({
              available: false,
            }),
          ],
        },
      ],
    };
    const props = createProps({ opened: true });
    renderPicker(props);
    const addButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Add from space"),
    );

    await act(async () => {
      addButton?.click();
      await Promise.resolve();
    });

    const result = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Source page"),
    );
    expect(result?.disabled).toBe(true);
    expect(result?.textContent).toContain("Excluded by the space AI policy");
  });

  it("applies document-only and all-descendants scopes and opens explicit selection", async () => {
    const props = createProps({ opened: true });
    renderPicker(props);

    const openScope = () =>
      [...document.body.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Document only",
      );
    const choose = (label: string) =>
      [...document.body.querySelectorAll("button")].find((button) =>
        button.textContent?.includes(label),
      );

    act(() => openScope()?.click());
    await act(async () => {
      choose("All child pages")?.click();
      await Promise.resolve();
    });
    expect(props.onSetCurrentDocumentDescendants).toHaveBeenCalledWith({
      mode: "all",
      pageIds: [],
    });

    act(() => openScope()?.click());
    await act(async () => {
      choose("Document only")?.click();
      await Promise.resolve();
    });
    expect(props.onSetCurrentDocumentDescendants).toHaveBeenCalledWith({
      mode: "none",
      pageIds: [],
    });

    act(() => openScope()?.click());
    act(() => choose("Selected child pages")?.click());
    expect(document.body.textContent).toContain(
      "Choose pages under Design brief",
    );
  });

  it("only renders expand actions for pages with children", () => {
    descendantsQuery.data = {
      items: [
        source({ pageId: "branch", title: "Branch page", hasChildren: true }),
        source({ pageId: "leaf", title: "Leaf page", hasChildren: false }),
      ],
    };
    renderPicker(createProps({ opened: true }));

    const openScope = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Document only",
    );
    act(() => openScope?.click());
    const selectPages = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Selected child pages"),
    );
    act(() => selectPages?.click());

    expect(document.body.textContent).toContain("Branch page");
    expect(document.body.textContent).toContain("Leaf page");
    expect(document.body.querySelectorAll('button[aria-label="Expand"]')).toHaveLength(
      1,
    );
  });

  it("routes a dropped page with children into the shared scope view", () => {
    const onPendingSourceHandled = vi.fn();
    const props = createProps({
      opened: true,
      pendingSource: source({ hasChildren: true }),
      onPendingSourceHandled,
    });
    renderPicker(props);

    expect(document.body.textContent).toContain("Choose scope");
    expect(document.body.textContent).toContain("Document only");
    expect(document.body.textContent).toContain("All child pages");
    expect(document.body.textContent).toContain("Selected child pages");

    const close = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Close"]',
    );
    act(() => close?.click());
    expect(onPendingSourceHandled).toHaveBeenCalledOnce();
    expect(props.onOpenedChange).toHaveBeenCalledWith(false);
  });

  it("renders private files and attachments with statuses and actions", () => {
    const props = createProps({
      opened: true,
      fileIds: ["file"],
      attachmentIds: ["attachment"],
      chatFiles: [
        chatFile(),
        chatFile({
          id: "processing",
          name: "notes.docx",
          status: "processing",
        }),
      ],
      pageAttachments: [pageAttachment()],
    });
    renderPicker(props);

    expect(document.body.textContent).toContain("Private files 1/10");
    expect(document.body.textContent).toContain("Attachments 1/20");
    expect(document.body.textContent).toContain("Processing");

    const inputByLabel = (text: string) => {
      const label = [...document.body.querySelectorAll("label")].find(
        (node) => node.textContent?.trim() === text,
      );
      return label?.htmlFor ? document.getElementById(label.htmlFor) : null;
    };
    const fileCheckbox = inputByLabel("brief.pdf") as HTMLInputElement | null;
    act(() => fileCheckbox?.click());
    expect(props.onToggleFile).toHaveBeenCalledWith("file", false);

    const attachmentCheckbox = inputByLabel(
      "wireframe.png",
    ) as HTMLInputElement | null;
    act(() => attachmentCheckbox?.click());
    expect(props.onToggleAttachment).toHaveBeenCalledWith("attachment", false);

    const deleteButton = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Delete file: brief.pdf"]',
    );
    act(() => deleteButton?.click());
    expect(props.onDeleteFile).toHaveBeenCalledWith("file", "brief.pdf");
  });

  it("blocks mutations while saving but keeps closing available", () => {
    const props = createProps({ opened: true, saving: true });
    renderPicker(props);

    expect(document.body.textContent).toContain("Saving");
    const switchInput = document.body.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(switchInput?.disabled).toBe(true);

    const close = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Close"]',
    );
    expect(close?.disabled).toBe(false);
    act(() => close?.click());
    expect(props.onOpenedChange).toHaveBeenCalledWith(false);
  });

  it("keeps retry available when autosave fails", () => {
    const props = createProps({ opened: true, saveFailed: true });
    renderPicker(props);
    const retry = [...document.body.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Try again"),
    );

    act(() => retry?.click());
    expect(props.onRetrySave).toHaveBeenCalledOnce();
  });
});
