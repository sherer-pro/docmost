import { generateNodeId } from '../utils';
import { UniqueID as TiptapUniqueID } from '@tiptap/extension-unique-id';

export const UniqueID = TiptapUniqueID.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      generateID: () => generateNodeId(),
    };
  },

  onCreate(event) {
    const provider = this.editor.extensionManager.extensions.find(
      (extension) =>
        ['collaboration', 'collaborationCaret'].includes(extension.name) &&
        extension.options.provider,
    )?.options.provider;

    if (!this.options.updateDocument || !provider?.synced) {
      this.parent?.(event);
      return;
    }

    // The live editor can mount after the provider's initial synced event.
    const { types, attributeName, generateID } = this.options;
    const { tr } = this.editor.state;
    tr.doc.descendants((node, pos) => {
      if (
        types.includes(node.type.name) &&
        node.attrs[attributeName] === null
      ) {
        tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          [attributeName]: generateID({ node, pos }),
        });
      }
    });
    if (tr.docChanged) {
      this.editor.view.dispatch(tr.setMeta('addToHistory', false));
    }
  },
});
