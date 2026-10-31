import "@mantine/core/styles.css";
import "@/features/editor/styles/index.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  MantineProvider,
  Button,
  Group,
  Stack,
  TextInput,
} from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { Provider, createStore } from "jotai";
import { EditorContent, useEditor } from "@tiptap/react";
import { UndoRedo } from "@tiptap/extensions";
import { mainExtensions } from "@/features/editor/extensions/extensions";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import { PublicDocumentContext } from "@/features/editor/components/database-embed/database-embed-context";
import { chooseIntegrationPaste } from "@/features/editor/components/integration-preview/integration-preview-paste";
import IntegrationPreviewConnections from "@/features/integration-preview/integration-preview-connections";
import { parseIntegrationPreviewUrl } from "@docmost/editor-ext";
import i18n, { i18nReady } from "@/i18n";

await i18nReady;
await i18n.changeLanguage("en-US");
const store = createStore();
const actor = (id: string) =>
  ({
    user: { id, role: "owner" },
    workspace: { id: "synthetic-workspace" },
  }) as any;
localStorage.setItem("currentUser", JSON.stringify(actor("viewer-a")));
store.set(currentUserAtom, actor("viewer-a"));
const params = new URLSearchParams(location.search);
function Fixture() {
  const [publicDocument, setPublicDocument] = useState(false);
  const [find, setFind] = useState("");
  const [json, setJson] = useState("");
  const editor = useEditor({
    extensions: [...mainExtensions, UndoRedo],
    onCreate: ({ editor }) => {
      (editor.storage as any).pageId = "11111111-1111-4111-8111-111111111111";
    },
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Integration fixture" }],
        },
      ],
    },
  });
  return (
    <Stack p="md">
      <Group>
        <Button
          onClick={() =>
            editor &&
            chooseIntegrationPaste(
              editor,
              parseIntegrationPreviewUrl(
                "https://github.com/private/project/issues/2",
              )!,
            )
          }
        >
          Insert GitHub
        </Button>
        <Button
          onClick={() => {
            store.set(currentUserAtom, actor("viewer-b"));
          }}
        >
          Switch viewer
        </Button>
        <Button onClick={() => setPublicDocument(true)}>Public document</Button>
        <Button
          onClick={() => {
            setJson(JSON.stringify(editor?.getJSON()));
          }}
        >
          Inspect saved data
        </Button>
        <Button onClick={() => editor?.commands.undo()}>Undo</Button>
        <Button onClick={() => editor?.commands.redo()}>Redo</Button>
        <Button
          onClick={() =>
            editor?.commands.insertContent({
              type: "integrationPreview",
              attrs: { url: "https://www.figma.com/design/AbCd123456/Design" },
            })
          }
        >
          Insert Figma
        </Button>
      </Group>
      <TextInput
        label="Find"
        value={find}
        onChange={(event) => {
          setFind(event.target.value);
          editor?.commands.setSearchTerm(event.target.value);
        }}
      />
      <PublicDocumentContext.Provider value={publicDocument}>
        <EditorContent editor={editor} />
      </PublicDocumentContext.Provider>
      <output data-testid="saved-data" style={{ overflowWrap: "anywhere" }}>{json}</output>
      <IntegrationPreviewConnections />
    </Stack>
  );
}
createRoot(document.getElementById("root")!).render(
  <Provider store={store}>
    <MantineProvider
      forceColorScheme={params.get("theme") === "dark" ? "dark" : "light"}
    >
      <ModalsProvider>
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider
            client={
              new QueryClient({ defaultOptions: { queries: { retry: false } } })
            }
          >
            <MemoryRouter>
              <Fixture />
            </MemoryRouter>
          </QueryClientProvider>
        </I18nextProvider>
      </ModalsProvider>
    </MantineProvider>
  </Provider>,
);
