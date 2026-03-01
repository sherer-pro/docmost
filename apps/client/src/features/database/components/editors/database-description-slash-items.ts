import getSuggestionItems from '@/features/editor/components/slash-menu/menu-items';
import {
  SlashMenuGroupedItemsType,
  SlashMenuItemType,
} from '@/features/editor/components/slash-menu/types';

const DATABASE_DESCRIPTION_ALLOWED_SLASH_COMMANDS = new Set([
  'Text',
  'To-do list',
  'Heading 1',
  'Heading 2',
  'Heading 3',
  'Bullet list',
  'Numbered list',
  'Quote',
  'Divider',
]);

/**
 * Returns slash-command items for the database description editor.
 *
 * Only lightweight and relevant formatting commands are exposed here,
 * so the description editor does not include heavy actions (uploads, embeds, etc.)
 * while still reacting correctly to the `/` trigger.
 */
export const getDatabaseDescriptionSlashItems = ({
  query,
}: {
  query: string;
}): SlashMenuGroupedItemsType => {
  const groupedItems = getSuggestionItems({ query });
  const filteredItems: SlashMenuGroupedItemsType = {};

  for (const [group, items] of Object.entries(groupedItems)) {
    const allowedItems = items.filter((item: SlashMenuItemType) => {
      return DATABASE_DESCRIPTION_ALLOWED_SLASH_COMMANDS.has(item.title);
    });

    if (allowedItems.length > 0) {
      filteredItems[group] = allowedItems;
    }
  }

  return filteredItems;
};
