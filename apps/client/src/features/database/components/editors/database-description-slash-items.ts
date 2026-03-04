import getSuggestionItems from '@/features/editor/components/slash-menu/menu-items';
import { SlashMenuGroupedItemsType } from '@/features/editor/components/slash-menu/types';

/**
 * Returns slash-command items for the database description editor.
 *
 * Database description editor uses the same slash-command provider as the page editor.
 */
export const getDatabaseDescriptionSlashItems = ({
  query,
}: {
  query: string;
}): SlashMenuGroupedItemsType => {
  return getSuggestionItems({ query });
};
