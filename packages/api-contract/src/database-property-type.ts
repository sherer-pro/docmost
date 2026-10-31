/**
 * Supported database property types shared between client and server.
 */
export const DATABASE_PROPERTY_TYPES = [
  "multiline_text",
  "checkbox",
  "code",
  "select",
  "user",
  "page_reference",
  "number",
  "date",
  "multi_select",
  "url",
  "email",
  "phone",
  "created_at",
  "updated_at",
  "updated_by",
  "file",
  "formula",
] as const;

/**
 * Union type for supported database property types.
 */
export type DatabasePropertyType = (typeof DATABASE_PROPERTY_TYPES)[number];

export const DATABASE_MUTATION_CONTRACT_VERSION = 4;
