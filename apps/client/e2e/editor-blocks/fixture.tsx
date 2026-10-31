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
function Controls() {
  const { editor } = useCurrentEditor();
  const [term, setTerm] = useState("");
  const [presenting, setPresenting] = useState(false);
  return (
    <Group>
      <Button onClick={() => setPresenting(true)}>Present fixture</Button>
      {presenting && (
        <PresentationModal
          title="Presentation fixture"
          onClose={() => setPresenting(false)}
          content={{
            type: "doc",
            content: [
              {
                type: "heading",
                attrs: { level: 1 },
                content: [{ type: "text", text: "First slide" }],
              },
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Commented source text",
                    marks: [
                      {
                        type: "comment",
                        attrs: { commentId: "fixture-thread" },
                      },
                    ],
                  },
                ],
              },
              { type: "horizontalRule" },
              {
                type: "heading",
                attrs: { level: 2 },
                content: [{ type: "text", text: "Long slide" }],
              },
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Readable long content. ".repeat(1000),
                  },
                ],
              },
              {
                type: "heading",
                attrs: { level: 3 },
                content: [{ type: "text", text: "Last slide" }],
              },
              {
                type: "tabs",
                attrs: { id: "presentation-tabs" },
                content: [
                  {
                    type: "tabItem",
                    attrs: { id: "present-one", title: "One" },
                    content: [
                      {
                        type: "paragraph",
                        content: [
                          { type: "text", text: "First presentation tab" },
                        ],
                      },
                    ],
                  },
                  {
                    type: "tabItem",
                    attrs: { id: "present-two", title: "Two" },
                    content: [
                      {
                        type: "paragraph",
                        content: [
                          { type: "text", text: "Second presentation tab" },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          }}
        />
      )}
      <Button onClick={() => editor?.commands.insertFootnote()}>
        Insert footnote
      </Button>
      <Button onClick={() => editor?.commands.undo()}>Undo</Button>
      <Button onClick={() => editor?.commands.redo()}>Redo</Button>
      <Button
        onClick={() => editor?.commands.setSearchTerm("Hidden tab evidence")}
      >
        Find hidden tab
      </Button>
      <TextInput
        label="Find"
        value={term}
        onChange={(event) => {
          setTerm(event.currentTarget.value);
          editor?.commands.setSearchTerm(event.currentTarget.value);
          const result = editor?.storage.searchAndReplace?.results?.[0];
          if (result)
            document.dispatchEvent(
              new CustomEvent("docmost:reveal-search-match", {
                detail: { editor, position: result.from },
                cancelable: true,
              }),
            );
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
                      type: "tabs",
                      attrs: { id: "fixture-tabs" },
                      content: [
                        {
                          type: "tabItem",
                          attrs: { id: "tab-one", title: "Overview" },
                          content: [
                            {
                              type: "paragraph",
                              content: [
                                { type: "text", text: "First tab body" },
                              ],
                            },
                          ],
                        },
                        {
                          type: "tabItem",
                          attrs: { id: "tab-two", title: "Details" },
                          content: [
                            {
                              type: "paragraph",
                              content: [
                                { type: "text", text: "Hidden tab evidence" },
                              ],
                            },
                          ],
                        },
                      ],
                    },
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
