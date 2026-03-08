import { DatabasePropertyType } from '@docmost/api-contract';

/**
 * Translation keys for user-facing database property type labels.
 *
 * We keep raw contract values like `multiline_text` and `page_reference`
 * out of the UI by mapping each type to a localized label key.
 */
export const DATABASE_PROPERTY_TYPE_LABEL_KEYS: Record<DatabasePropertyType, string> = {
  multiline_text: 'Text',
  checkbox: 'Checkbox',
  code: 'Code',
  select: 'Select',
  user: 'User',
  page_reference: 'Page',
};
