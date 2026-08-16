import "@/features/editor/styles/index.css";
import clsx from "clsx";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import {
  HocuspocusProvider,
  onStatusParameters,
  WebSocketStatus,
  HocuspocusProviderWebsocket,
  onSyncedParameters,
  onUnsyncedChangesParameters,
} from "@hocuspocus/provider";
import {
  Editor,
  EditorContent,
  EditorProvider,
  useEditor,
  useEditorState,
} from "@tiptap/react";
import {
  collabExtensions,
  createMainExtensions,
} from "@/features/editor/extensions/extensions";
import { useAtom, useSetAtom } from "jotai";
import useCollaborationUrl from "@/features/editor/hooks/use-collaboration-url";
import {
  currentUserAtom,
  workspaceAtom,
} from "@/features/user/atoms/current-user-atom";
import {
  activePageUsersAtom,
  pageEditorAtom,
  pageEditorUnsyncedChangesAtom,
  yjsConnectionStatusAtom,
} from "@/features/editor/atoms/editor-atoms";
import CommentDialog from "@/features/comment/components/comment-dialog";
import {
  EditorBubbleMenu,
  ReadOnlyCommentBubbleMenu,
} from "@/features/editor/components/bubble-menu/bubble-menu";
import TableCellMenu from "@/features/editor/components/table/table-cell-menu.tsx";
import TableMenu from "@/features/editor/components/table/table-menu.tsx";
import ImageMenu from "@/features/editor/components/image/image-menu.tsx";
import CalloutMenu from "@/features/editor/components/callout/callout-menu.tsx";
import VideoMenu from "@/features/editor/components/video/video-menu.tsx";
import AudioMenu from "@/features/editor/components/audio/audio-menu.tsx";
import PdfMenu from "@/features/editor/components/pdf/pdf-menu.tsx";
import SubpagesMenu from "@/features/editor/components/subpages/subpages-menu.tsx";
import LinkMenu from "@/features/editor/components/link/link-menu.tsx";
import ExcalidrawMenu from "./components/excalidraw/excalidraw-menu";
import DrawioMenu from "./components/drawio/drawio-menu";
import { useCollabToken } from "@/features/auth/queries/auth-query.tsx";
import SearchAndReplaceDialog from "@/features/editor/components/search-and-replace/search-and-replace-dialog.tsx";
import { useDebouncedCallback, useDocumentVisibility } from "@mantine/hooks";
import { useIdle } from "@/hooks/use-idle.ts";
import { queryClient } from "@/lib/query-client.ts";
import { IPage } from "@/features/page/types/page.types.ts";
import { useParams } from "react-router-dom";
import { extractPageSlugId } from "@/lib";
import { FIVE_MINUTES } from "@/lib/constants.ts";
import { PageEditMode } from "@/features/user/types/user.types.ts";
import { resolvePageEditMode } from "@/features/user/utils/page-edit-mode.ts";
import {
  searchSpotlight,
  searchSpotlightIntentAtom,
} from "@/features/search/constants.ts";
import { useEditorScroll } from "./hooks/use-editor-scroll";
import { usePageEditorInteractions } from "@/features/editor/hooks/use-page-editor-interactions";
import { DictionaryHighlightLayer } from "@/features/dictionary/components/dictionary-highlight-layer";
import {
  DictionaryHighlightExtension,
  dictionaryHighlightPluginKey,
} from "@/features/dictionary/extensions/dictionary-highlight-extension";
import { useDictionaryTermsQuery } from "@/features/dictionary/queries/dictionary-query";
import { createDictionaryMatcherIndex } from "@/features/dictionary/utils/dictionary-matcher";
import { TransclusionLookupProvider } from "@/features/editor/components/transclusion/transclusion-lookup-context";
import { PageTemplatePicker } from "@/features/page-template/components/page-template-picker";
import { FixedToolbar } from "@/features/editor/components/fixed-toolbar/fixed-toolbar";
import { getEnabledTagDefinitions } from "@/features/editor/components/tag/tag-settings";
import { getUserColor } from "@/features/editor/extensions/utils.ts";
import { useTranslation } from "react-i18next";
import type { TemplateKind } from "@docmost/api-contract";
import { TemplateBlockToolbar } from "@/features/editor/components/page-template/template-block-toolbar";

interface PageEditorProps {
  pageId: string;
  editable: boolean;
  content: any;
  cacheSlugId?: string;
  showBottomSpacer?: boolean;
  editorContentClassName?: string;
  spaceId?: string;
  dictionaryEnabled?: boolean;
  canManageDictionary?: boolean;
  canCreateInlineComments?: boolean;
  headingNumberingEnabled?: boolean;
  spaceHeadingNumberingEnabled?: boolean;
  templateKind?: TemplateKind | null;
}

export default function PageEditor({
  pageId,
  editable,
  content,
  cacheSlugId,
  showBottomSpacer = true,
  editorContentClassName,
  spaceId,
  dictionaryEnabled = false,
  canManageDictionary = false,
  canCreateInlineComments = editable,
  headingNumberingEnabled = false,
  spaceHeadingNumberingEnabled = false,
  templateKind = null,
}: PageEditorProps) {
  const { t } = useTranslation();
  const collaborationURL = useCollaborationUrl();
  const isComponentMounted = useRef(false);
  const editorRef = useRef<Editor | null>(null);

  useEffect(() => {
    isComponentMounted.current = true;

    return () => {
      isComponentMounted.current = false;
    };
  }, []);

  const [currentUser] = useAtom(currentUserAtom);
  const [workspace] = useAtom(workspaceAtom);
  const [, setEditor] = useAtom(pageEditorAtom);
  const [, setActivePageUsers] = useAtom(activePageUsersAtom);
  const [, setUnsyncedChanges] = useAtom(pageEditorUnsyncedChangesAtom);
  const setSearchSpotlightIntent = useSetAtom(searchSpotlightIntentAtom);
  const [isLocalSynced, setIsLocalSynced] = useState(false);
  const [isRemoteSynced, setIsRemoteSynced] = useState(false);
  const [yjsConnectionStatus, setYjsConnectionStatus] = useAtom(
    yjsConnectionStatusAtom,
  );
  const menuContainerRef = useRef(null);
  const {
    showCommentPopup: sharedShowCommentPopup,
    handleKeyDown,
    handleBeforeInput,
    handleEditorPaste,
    handleEditorDrop,
  } = usePageEditorInteractions({
    pageId,
    editorRef,
    userId: currentUser?.user.id,
    supportPlainTextPaste: true,
  });
  const { data: collabQuery, refetch: refetchCollabToken } =
    useCollabToken(pageId);
  const collabTokenRef = useRef(collabQuery?.token);
  const refetchCollabTokenRef = useRef(refetchCollabToken);
  collabTokenRef.current = collabQuery?.token;
  refetchCollabTokenRef.current = refetchCollabToken;
  const hasCollabToken = Boolean(collabQuery?.token);
  const { isIdle, resetIdle } = useIdle(FIVE_MINUTES, { initialState: false });
  const documentState = useDocumentVisibility();
  const { pageSlug } = useParams();
  const resolvedCacheSlugId = cacheSlugId ?? extractPageSlugId(pageSlug);
  const userPageEditMode = resolvePageEditMode({
    pageId,
    preferences: currentUser?.user?.settings?.preferences,
  });
  const fixedToolbarEnabled = Boolean(
    currentUser?.user?.settings?.preferences?.fixedToolbar,
  );
  const { data: dictionaryTerms = [] } = useDictionaryTermsQuery(
    spaceId,
    Boolean(spaceId && dictionaryEnabled),
  );
  const activeDictionaryTerms = useMemo(
    () => (dictionaryEnabled ? dictionaryTerms : []),
    [dictionaryEnabled, dictionaryTerms],
  );
  const dictionaryMatcherIndex = useMemo(
    () => createDictionaryMatcherIndex(activeDictionaryTerms),
    [activeDictionaryTerms],
  );
  const canScroll = useCallback(
    () => Boolean(isComponentMounted.current && editorRef.current),
    [isComponentMounted],
  );
  const { handleScrollTo } = useEditorScroll({ canScroll });
  const tagDefinitions = useMemo(
    () => getEnabledTagDefinitions(workspace?.settings?.tags),
    [workspace?.settings?.tags],
  );
  const handleSearchTag = useCallback(
    (tag: "tbd" | "todo" | "done") => {
      if (!spaceId) return;
      setSearchSpotlightIntent({ intent: { spaceId, tags: [tag] } });
      searchSpotlight.open();
    },
    [setSearchSpotlightIntent, spaceId],
  );
  const mainEditorExtensions = useMemo(
    () =>
      createMainExtensions({ tagDefinitions, onSearchTag: handleSearchTag }),
    [handleSearchTag, tagDefinitions],
  );
  const editorExtensions = useMemo(
    () => [...mainEditorExtensions, DictionaryHighlightExtension],
    [mainEditorExtensions],
  );
  const staticContentExtensions = useMemo(
    () => [
      ...mainEditorExtensions,
      DictionaryHighlightExtension.configure({
        enabled: dictionaryEnabled,
        terms: activeDictionaryTerms,
        matcherIndex: dictionaryMatcherIndex,
      }),
    ],
    [
      activeDictionaryTerms,
      dictionaryEnabled,
      dictionaryMatcherIndex,
      mainEditorExtensions,
    ],
  );
  const staticContentKey = useMemo(
    () =>
      [
        pageId,
        dictionaryEnabled ? "dictionary-on" : "dictionary-off",
        activeDictionaryTerms
          .map((term) => `${term.id}:${term.updatedAt}`)
          .join("|"),
        headingNumberingEnabled
          ? "heading-numbering-on"
          : "heading-numbering-off",
        tagDefinitions.map((tag) => tag.value).join("|"),
      ].join(":"),
    [
      activeDictionaryTerms,
      dictionaryEnabled,
      headingNumberingEnabled,
      pageId,
      tagDefinitions,
    ],
  );
  const syncDictionaryHighlights = useCallback(
    (targetEditor?: Editor | null) => {
      const currentEditor = targetEditor ?? editorRef.current;

      if (!currentEditor || currentEditor.isDestroyed) {
        return;
      }

      currentEditor.view.dispatch(
        currentEditor.state.tr.setMeta(dictionaryHighlightPluginKey, {
          enabled: dictionaryEnabled,
          terms: activeDictionaryTerms,
          matcherIndex: dictionaryMatcherIndex,
          rebuild: true,
        }),
      );
    },
    [activeDictionaryTerms, dictionaryEnabled, dictionaryMatcherIndex],
  );
  // Providers only created once per pageId
  const providersRef = useRef<{
    local: IndexeddbPersistence;
    remote: HocuspocusProvider;
    socket: HocuspocusProviderWebsocket;
  } | null>(null);
  const [providersReady, setProvidersReady] = useState(false);

  useEffect(() => {
    if (!hasCollabToken) {
      return;
    }

    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    if (!providersRef.current) {
      const initialToken = collabTokenRef.current;

      if (!initialToken) {
        return;
      }

      const documentName = `page.${pageId}`;
      const ydoc = new Y.Doc();
      const local = new IndexeddbPersistence(documentName, ydoc);
      const socket = new HocuspocusProviderWebsocket({
        url: collaborationURL,
      });
      const onLocalSyncedHandler = () => {
        setIsLocalSynced(true);
      };
      const onStatusHandler = (event: onStatusParameters) => {
        setYjsConnectionStatus(event.status);
      };
      const onSyncedHandler = (event: onSyncedParameters) => {
        setIsRemoteSynced(event.state);
      };
      const onUnsyncedChangesHandler = (event: onUnsyncedChangesParameters) => {
        setUnsyncedChanges(event.number);
      };
      let authRefreshInFlight = false;
      const onAuthenticationFailedHandler = async () => {
        if (authRefreshInFlight || !isComponentMounted.current) {
          return;
        }

        authRefreshInFlight = true;

        try {
          const result = await refetchCollabTokenRef.current();
          const nextToken = result.data?.token;

          if (!nextToken || !isComponentMounted.current) {
            return;
          }

          collabTokenRef.current = nextToken;
          remote.configuration.token = nextToken;
          socket.disconnect();
          reconnectTimeout = setTimeout(() => {
            reconnectTimeout = null;

            if (
              isComponentMounted.current &&
              providersRef.current?.remote === remote
            ) {
              socket.connect();
            }

            authRefreshInFlight = false;
          }, 100);
        } finally {
          if (!reconnectTimeout) {
            authRefreshInFlight = false;
          }
        }
      };
      const remote = new HocuspocusProvider({
        websocketProvider: socket,
        name: documentName,
        document: ydoc,
        token: initialToken,
        onAuthenticationFailed: onAuthenticationFailedHandler,
        onStatus: onStatusHandler,
        onSynced: onSyncedHandler,
        onUnsyncedChanges: onUnsyncedChangesHandler,
      });

      /**
       * Synchronizes the list of active page users from Yjs awareness.
       *
       * Awareness can include multiple connections for the same user
       * (for example, when the page is open in multiple tabs), so the list is
       * deduplicated by user identifier.
       */
      const syncActivePageUsers = () => {
        const states = Array.from(remote.awareness.getStates().values());
        const uniqueUsers = new Map<
          string,
          { id: string; name: string; avatarUrl: string }
        >();

        states.forEach((state) => {
          const awarenessUser = state?.user as
            | { id?: string; name?: string; avatarUrl?: string }
            | undefined;

          if (!awarenessUser?.id || !awarenessUser?.name) {
            return;
          }

          uniqueUsers.set(awarenessUser.id, {
            id: awarenessUser.id,
            name: awarenessUser.name,
            avatarUrl: awarenessUser.avatarUrl ?? "",
          });
        });

        setActivePageUsers(Array.from(uniqueUsers.values()));
      };

      remote.awareness.on("change", syncActivePageUsers);
      syncActivePageUsers();

      local.on("synced", onLocalSyncedHandler);
      providersRef.current = { socket, local, remote };
      setProvidersReady(true);
    } else {
      setProvidersReady(true);
    }
    // Only destroy on final unmount
    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      setActivePageUsers([]);
      setUnsyncedChanges(0);
      providersRef.current?.socket.destroy();
      providersRef.current?.remote.destroy();
      providersRef.current?.local.destroy();
      providersRef.current = null;
      setProvidersReady(false);
    };
  }, [
    collaborationURL,
    hasCollabToken,
    pageId,
    setActivePageUsers,
    setUnsyncedChanges,
    setYjsConnectionStatus,
  ]);

  // Only connect/disconnect on tab/idle, not destroy
  useEffect(() => {
    if (!providersReady || !providersRef.current) return;
    const socket = providersRef.current.socket;

    if (
      isIdle &&
      documentState === "hidden" &&
      yjsConnectionStatus === WebSocketStatus.Connected
    ) {
      socket.disconnect();
      return;
    }
    if (
      documentState === "visible" &&
      yjsConnectionStatus === WebSocketStatus.Disconnected
    ) {
      resetIdle();
      socket.connect();
    }
  }, [isIdle, documentState, providersReady, resetIdle]);

  useEffect(() => {
    if (!providersReady || !providersRef.current) return;

    const remote = providersRef.current.remote;
    remote.attach();

    return () => {
      remote.detach?.();
    };
  }, [providersReady, pageId]);

  const collaborationUserRef = useRef(currentUser?.user);
  collaborationUserRef.current = currentUser?.user;
  const collaborationUserId = currentUser?.user.id;
  const extensions = useMemo(() => {
    const collaborationUser = collaborationUserRef.current;

    if (!providersReady || !providersRef.current || !collaborationUser) {
      return editorExtensions;
    }

    const remoteProvider = providersRef.current.remote;

    return [
      ...editorExtensions,
      ...collabExtensions(remoteProvider, collaborationUser),
    ];
  }, [collaborationUserId, editorExtensions, providersReady]);

  const editor = useEditor(
    {
      extensions,
      editable: editable && userPageEditMode === PageEditMode.Edit,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-label": t("Editor"),
          "aria-multiline": "true",
        },
        scrollThreshold: 80,
        scrollMargin: 80,
        handleDOMEvents: {
          keydown: (_view, event) => {
            if ((event.ctrlKey || event.metaKey) && event.code === "KeyS") {
              event.preventDefault();
              return true;
            }
            if ((event.ctrlKey || event.metaKey) && event.code === "KeyK") {
              searchSpotlight.open();
              return true;
            }

            return handleKeyDown(_view, event);
          },
          beforeinput: handleBeforeInput,
        },
        handlePaste: handleEditorPaste,
        handleDrop: handleEditorDrop,
      },
      onCreate({ editor }) {
        if (editor) {
          // @ts-ignore
          setEditor(editor);
          // @ts-ignore
          editor.storage.pageId = pageId;
          (editor.storage as any).templateKind = templateKind;
          handleScrollTo(editor);
          editorRef.current = editor;
        }
      },
      onUpdate({ editor }) {
        if (editor.isEmpty) return;
        const editorJson = editor.getJSON();
        //update local page cache to reduce flickers
        debouncedUpdateContent(editorJson);
      },
    },
    [pageId, extensions],
  );

  useEffect(() => {
    if (!editor) {
      return;
    }

    return () => {
      if (editorRef.current === editor) {
        editorRef.current = null;
      }

      setEditor((currentEditor) =>
        currentEditor === editor ? null : currentEditor,
      );
    };
  }, [editor, setEditor]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    syncDictionaryHighlights(editor);
  }, [editor, syncDictionaryHighlights]);

  useEffect(() => {
    const user = currentUser?.user;

    if (!editor || editor.isDestroyed || !providersReady || !user) {
      return;
    }

    editor.commands.updateUser({
      id: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl,
      color: getUserColor(user.id),
    });
  }, [
    currentUser?.user.avatarUrl,
    currentUser?.user.id,
    currentUser?.user.name,
    editor,
    providersReady,
  ]);

  useEffect(() => {
    editor?.commands.setHeadingNumberingEnabled(headingNumberingEnabled);
  }, [editor, headingNumberingEnabled]);

  useEffect(() => {
    editor?.commands.setHeadingNumberingPasteCleanupEnabled(
      spaceHeadingNumberingEnabled,
    );
  }, [editor, spaceHeadingNumberingEnabled]);

  const editorIsEditable = useEditorState({
    editor,
    selector: (ctx) => {
      return ctx.editor?.isEditable ?? false;
    },
  });

  const debouncedUpdateContent = useDebouncedCallback((newContent: any) => {
    if (!resolvedCacheSlugId) {
      return;
    }

    const pageData = queryClient.getQueryData<IPage>([
      "pages",
      resolvedCacheSlugId,
    ]);

    if (pageData) {
      queryClient.setQueryData(["pages", resolvedCacheSlugId], {
        ...pageData,
        content: newContent,
        updatedAt: new Date(),
      });
    }
  }, 3000);

  const isSynced = isLocalSynced && isRemoteSynced;

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (yjsConnectionStatus === WebSocketStatus.Connecting || !isSynced) {
        setYjsConnectionStatus(WebSocketStatus.Disconnected);
      }
    }, 7500);

    return () => clearTimeout(timeout);
  }, [yjsConnectionStatus, isSynced]);
  useEffect(() => {
    if (editor) {
      editor.setEditable(editable && userPageEditMode === PageEditMode.Edit);
    }
  }, [userPageEditMode, editor, editable]);

  const hasConnectedOnceRef = useRef(false);
  const [showStatic, setShowStatic] = useState(true);

  useEffect(() => {
    if (
      !hasConnectedOnceRef.current &&
      yjsConnectionStatus === WebSocketStatus.Connected &&
      isSynced
    ) {
      hasConnectedOnceRef.current = true;
      setShowStatic(false);
    }
  }, [yjsConnectionStatus, isSynced]);

  if (showStatic) {
    return (
      <>
        <TransclusionLookupProvider>
          <DictionaryHighlightLayer terms={activeDictionaryTerms}>
            <EditorProvider
              key={staticContentKey}
              editable={false}
              immediatelyRender={true}
              extensions={staticContentExtensions}
              content={content}
              editorProps={{
                attributes: {
                  role: "textbox",
                  "aria-label": t("Editor"),
                  "aria-multiline": "true",
                },
              }}
              onCreate={({ editor: staticEditor }) => {
                staticEditor.commands.setHeadingNumberingEnabled(
                  headingNumberingEnabled,
                );
              }}
            />
          </DictionaryHighlightLayer>
        </TransclusionLookupProvider>
        <PageTemplatePicker pageId={pageId} spaceId={spaceId} />
      </>
    );
  }

  return (
    <>
      <TransclusionLookupProvider>
        <div className="editor-container" style={{ position: "relative" }}>
          <div ref={menuContainerRef}>
            {editor && editorIsEditable && templateKind === "synced" && (
              <TemplateBlockToolbar editor={editor} />
            )}
            {editor && editorIsEditable && fixedToolbarEnabled && (
              <>
                <FixedToolbar
                  editor={editor}
                  pageId={pageId}
                  spaceId={spaceId}
                  dictionaryEnabled={dictionaryEnabled}
                  canManageDictionary={canManageDictionary}
                  canCreateInlineComments={canCreateInlineComments}
                />
              </>
            )}

            <DictionaryHighlightLayer terms={activeDictionaryTerms}>
              <EditorContent
                editor={editor}
                className={clsx(editorContentClassName)}
              />
            </DictionaryHighlightLayer>

            {editor && (
              <SearchAndReplaceDialog editor={editor} editable={editable} />
            )}

            {editor && editorIsEditable && (
              <div>
                {!fixedToolbarEnabled && (
                  <EditorBubbleMenu
                    editor={editor}
                    pageId={pageId}
                    spaceId={spaceId}
                    dictionaryEnabled={dictionaryEnabled}
                    canManageDictionary={canManageDictionary}
                    canCreateInlineComments={canCreateInlineComments}
                  />
                )}
                <TableMenu editor={editor} />
                <TableCellMenu editor={editor} appendTo={menuContainerRef} />
                <ImageMenu editor={editor} />
                <VideoMenu editor={editor} />
                <AudioMenu editor={editor} />
                <PdfMenu editor={editor} />
                <CalloutMenu editor={editor} />
                <SubpagesMenu editor={editor} />
                <ExcalidrawMenu editor={editor} />
                <DrawioMenu editor={editor} />
                <LinkMenu editor={editor} appendTo={menuContainerRef} />
              </div>
            )}
            {editor && !editorIsEditable && canCreateInlineComments && (
              <ReadOnlyCommentBubbleMenu editor={editor} />
            )}
            {sharedShowCommentPopup && (
              <CommentDialog editor={editor} pageId={pageId} />
            )}
          </div>
          {showBottomSpacer && (
            <div
              onClick={() => editor.commands.focus("end")}
              style={{ paddingBottom: "20vh" }}
            ></div>
          )}
        </div>
      </TransclusionLookupProvider>
      <PageTemplatePicker pageId={pageId} spaceId={spaceId} />
    </>
  );
}
