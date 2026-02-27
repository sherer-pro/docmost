import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

export interface LinkPreviewOptions {
  HTMLAttributes: Record<string, any>;
  view: any;
}

export interface LinkPreviewAttributes {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    linkPreview: {
      setLinkPreview: (attributes: LinkPreviewAttributes) => ReturnType;
    };
  }
}

export const LinkPreview = Node.create<LinkPreviewOptions>({
  name: "linkPreview",

  addOptions() {
    return {
      HTMLAttributes: {},
      view: null,
    };
  },

  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      url: {
        default: null,
      },
      title: {
        default: "",
      },
      description: {
        default: "",
      },
      image: {
        default: "",
      },
      siteName: {
        default: "",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `div[data-type="${this.name}"]`,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(
        { "data-type": this.name },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
    ];
  },

  addCommands() {
    return {
      setLinkPreview:
        (attributes) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: attributes,
          });
        },
    };
  },

  addNodeView() {
    this.editor.isInitialized = true;

    return ReactNodeViewRenderer(this.options.view);
  },
});
