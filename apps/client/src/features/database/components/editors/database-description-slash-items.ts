import getSuggestionItems from '@/features/editor/components/slash-menu/menu-items';
import { SlashMenuGroupedItemsType } from '@/features/editor/components/slash-menu/types';

const unsupportedDescriptionSlashTitles = new Set([
  'Image',
  'Video',
  'File attachment',
  'Callout',
  'Mermaid diagram',
  'Draw.io (diagrams.net) ',
  'Excalidraw diagram',
  'Link preview',
  'Date',
  'Subpages (Child pages)',
  'Iframe embed',
  'Airtable',
  'Loom',
  'Figma',
  'Typeform',
  'Miro',
  'YouTube',
  'Vimeo',
  'Framer',
  'Google Drive',
  'Google Sheets',
  'Linked quote',
]);

/**
 * Returns slash-command items for the database description editor.
 *
 * Description editor keeps only commands supported by its lightweight UI.
 */
export const getDatabaseDescriptionSlashItems = ({
  query,
}: {
  query: string;
}): SlashMenuGroupedItemsType => {
  const suggestionItems = getSuggestionItems({ query });

  return Object.fromEntries(
    Object.entries(suggestionItems)
      .map(([group, items]) => {
        const filteredItems = items.filter((item) => {
          return !unsupportedDescriptionSlashTitles.has(item.title);
        });

        return [group, filteredItems];
      })
      .filter(([, items]) => items.length > 0),
  );
};
