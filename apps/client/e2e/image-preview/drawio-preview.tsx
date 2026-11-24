import { useMantineColorScheme } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditorContent, ReactNodeViewRenderer, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Drawio } from "@docmost/editor-ext";
import DrawioView from "@/features/editor/components/drawio/drawio-view";

const queryClient = new QueryClient();

export default function DrawioPreview() {
  const { toggleColorScheme } = useMantineColorScheme();
  const editor = useEditor({
    extensions: [
      StarterKit,
      Drawio.configure({ view: ReactNodeViewRenderer(DrawioView) }),
    ],
    editable: false,
    content: {
      type: "doc",
      content: ["MCP", "Vector"].map((title, index) => {
        const attachmentId = `11111111-1111-5111-8111-11111111111${index}`;
        return {
          type: "drawio",
          attrs: {
            attachmentId,
            title,
            width: "240px",
            src: `/api/attachments/files/${attachmentId}/diagram.drawio.svg`,
          },
        };
      }),
    },
  });
  return (
    <>
      <button onClick={() => toggleColorScheme()}>Switch theme</button>
      <QueryClientProvider client={queryClient}>
        <EditorContent editor={editor} />
      </QueryClientProvider>
      <img
        src="/api/attachments/files/11111111-1111-5111-8111-111111111111/diagram.drawio.svg"
        alt="Native SVG reference"
        width={240}
      />
    </>
  );
}
