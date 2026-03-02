/**
 * Supported database property types shared between client and server.
 */
export const DATABASE_PROPERTY_TYPES = [
  'multiline_text',
  'checkbox',
  'code',
  'select',
  'user',
  'page_reference',
] as const;

/**
 * Union type for supported database property types.
 */
export type DatabasePropertyType = (typeof DATABASE_PROPERTY_TYPES)[number];
