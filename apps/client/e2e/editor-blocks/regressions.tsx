import "@mantine/core/styles.css";
import "@/features/editor/styles/index.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, Group, MantineProvider, TextInput } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { EditorProvider, useCurrentEditor } from "@tiptap/react";
import { Node, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { mainExtensions } from "@/features/editor/extensions/extensions";
import { Footnotes } from "@/features/editor/components/footnote/footnotes";
import PresentationModal from "@/features/editor/components/presentation/presentation-modal";

const i18n = createInstance();
await i18n.init({
  lng: "en-US",
  resources: {
    "en-US": {
      translation: await (
        await fetch("/locales/en-US/translation.json")
      ).json(),
    },
  },
});
const image = (width = 720, ratio = 16 / 9): JSONContent => ({
  type: "image",
  attrs: {
    src: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${ratio * 900}" height="900"><rect width="100%" height="100%" fill="#729dc7"/></svg>`)}`,
    width,
    aspectRatio: ratio,
    alt: "Responsive fixture",
  },
});
const table = (widthMode: string): JSONContent => ({
  type: "table",
  attrs: { widthMode },
  content: ["tableHeader", "tableCell"].map((type) => ({
    type: "tableRow",
    content: Array.from({ length: 3 }, (_, index) => ({
      type,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: `${index}: readable long table content`.repeat(4),
            },
          ],
        },
      ],
    })),
  })),
});
const content: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Source " },
        {
          type: "footnote",
          attrs: { id: "note-one" },
          content: [{ type: "text", text: "First canonical note" }],
        },
        { type: "text", text: " after" },
      ],
    },
    { type: "paragraph", content: [{ type: "text", text: "Destination" }] },
    image(),
    ...["normal", "wide", "full"].map(table),
    {
      type: "tabs",
      attrs: { id: "tabs" },
      content: [
        {
          type: "tabItem",
          attrs: { id: "first", title: "Tables" },
          content: [
            ...["normal", "wide", "full"].map(table),
            image(720, 2 / 3),
          ],
        },
      ],
    },
    { type: "ownedWidget" },
  ],
};

// A foreign contentEditable=false widget exercises the native CSS ownership boundary.
// Live DatabaseTableView behavior is accepted separately by the database runner.
const OwnedWidget = Node.create({
  name: "ownedWidget",
  group: "block",
  atom: true,
  renderHTML: () => ["div", { "data-owned-widget": "" }],
  addNodeView() {
    return () => {
      const dom = document.createElement("div");
      dom.contentEditable = "false";
      dom.dataset.ownedWidget = "";
      dom.style.overflowX = "auto";
      dom.innerHTML =
        '<table class="ownedWidgetTable"><tbody><tr><th>Widget title</th><th>Property</th></tr><tr><td data-background-color="#b4d5ff">Readable widget title</td><td>Value</td></tr></tbody></table>';
      return { dom };
    };
  },
});

function Controls() {
  const { editor } = useCurrentEditor();
  const [presenting, setPresenting] = useState(false);
  useEffect(() => {
    (window as any).regressionEditor = editor;
    return () => {
      delete (window as any).regressionEditor;
    };
  }, [editor]);
  return (
    <>
      <Group>
        <Button onClick={() => setPresenting(true)}>Present images</Button>
        <Button onClick={() => editor?.setEditable(!editor.isEditable)}>
          Toggle readonly
        </Button>
        <Button onClick={() => editor?.commands.setContent(content)}>
          Reset fixture
        </Button>
        <TextInput label="Independent input" />
      </Group>
      {presenting && (
        <PresentationModal
          title="Responsive image"
          content={{ type: "doc", content: [image()] }}
          onClose={() => setPresenting(false)}
        />
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <MantineProvider
    forceColorScheme={
      new URLSearchParams(location.search).get("theme") === "dark"
        ? "dark"
        : "light"
    }
  >
    <ModalsProvider>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <style>{`.ownedWidgetTable { table-layout: auto; width: 900px; min-width: 900px; } .ownedWidgetTable td, .ownedWidgetTable th { min-width: 0; padding: 9px; background: transparent; }`}</style>
            <div
              style={{
                maxWidth: 850,
                padding: 16,
                margin: "24px auto",
                minWidth: 0,
              }}
            >
              <EditorProvider
                extensions={[...mainExtensions, UndoRedo, OwnedWidget]}
                content={content}
              >
                <Controls />
                <Footnotes />
              </EditorProvider>
            </div>
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>
    </ModalsProvider>
  </MantineProvider>,
);
