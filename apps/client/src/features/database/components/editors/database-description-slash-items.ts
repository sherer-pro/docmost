import getSuggestionItems from '@/features/editor/components/slash-menu/menu-items';
import { SlashMenuGroupedItemsType } from '@/features/editor/components/slash-menu/types';

/**
 * Returns slash-command items for the database description editor.
 *
 * Reuses the same command catalog as the page editor, so `/` suggestions
 * remain consistent across both editing experiences.
 */
export const getDatabaseDescriptionSlashItems = ({
  query,
}: {
  query: string;
}): SlashMenuGroupedItemsType => {
  return getSuggestionItems({ query });
};
