import "@mantine/core/styles.css";
import "@/features/editor/styles/index.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider, Button, TextInput, Group } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { EditorProvider, useCurrentEditor } from "@tiptap/react";
import { UndoRedo } from "@tiptap/extensions";
import { mainExtensions } from "@/features/editor/extensions/extensions";
import { Footnotes } from "@/features/editor/components/footnote/footnotes";

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
function Controls() {
  const { editor } = useCurrentEditor();
  const [term, setTerm] = useState("");
  return (
    <Group>
      <Button onClick={() => editor?.commands.insertFootnote()}>
        Insert footnote
      </Button>
      <Button onClick={() => editor?.commands.undo()}>Undo</Button>
      <Button onClick={() => editor?.commands.redo()}>Redo</Button>
      <TextInput
        label="Find"
        value={term}
        onChange={(event) => {
          setTerm(event.currentTarget.value);
          editor?.commands.setSearchTerm(event.currentTarget.value);
        }}
      />
    </Group>
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
            <div style={{ maxWidth: 900, margin: "24px auto", padding: 16 }}>
              <Footnotes editor={null} />
              <EditorProvider
                extensions={[...mainExtensions, UndoRedo]}
                content={{
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        { type: "text", text: "Source " },
                        {
                          type: "footnote",
                          attrs: { id: "note-one" },
                          content: [
                            { type: "text", text: "First canonical note" },
                          ],
                        },
                        { type: "text", text: " after." },
                      ],
                    },
                    {
                      type: "paragraph",
                      content: [
                        { type: "text", text: "Русский English العربية" },
                      ],
                    },
                    {
                      type: "paragraph",
                      content: [
                        { type: "text", text: "مرحبا English русский" },
                      ],
                    },
                    {
                      type: "bulletList",
                      content: [
                        {
                          type: "listItem",
                          content: [
                            {
                              type: "paragraph",
                              content: [{ type: "text", text: "שלום English" }],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      type: "table",
                      content: [
                        {
                          type: "tableRow",
                          content: [
                            {
                              type: "tableHeader",
                              content: [
                                {
                                  type: "paragraph",
                                  content: [
                                    { type: "text", text: "العربية English" },
                                  ],
                                },
                              ],
                            },
                            {
                              type: "tableCell",
                              content: [
                                {
                                  type: "paragraph",
                                  content: [
                                    { type: "text", text: "English русский" },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                }}
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
