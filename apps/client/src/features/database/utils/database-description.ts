import type { JSONContent } from '@tiptap/react';
export const EMPTY_DESCRIPTION_DOC: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

function tryParseJsonDescription(value: unknown): JSONContent | null {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(value);

    if (parsed && typeof parsed === 'object') {
      return parsed as JSONContent;
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Normalizes database description source to valid Tiptap doc JSON.
 *
 * JSON (`descriptionContent`) is the primary source.
 * Plain text (`description`) is only a fallback
 * for legacy or partially populated data.
 */
export function toDatabaseDescriptionDoc(
  richDescription?: unknown,
  plainDescription?: string | null,
): JSONContent {
  if (richDescription && typeof richDescription === 'object') {
    return richDescription as JSONContent;
  }

  const parsedRichDescription = tryParseJsonDescription(richDescription);
  if (parsedRichDescription) {
    return parsedRichDescription;
  }

  const text = typeof richDescription === 'string' ? richDescription.trim() : plainDescription?.trim();

  if (!text) {
    return EMPTY_DESCRIPTION_DOC;
  }

  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  };
}

export function serializeDatabaseDescription(json: JSONContent): string {
  return JSON.stringify(json ?? EMPTY_DESCRIPTION_DOC);
}
