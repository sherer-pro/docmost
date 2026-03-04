import type { JSONContent } from '@tiptap/react';
import { generateText } from '@tiptap/core';
import { mainExtensions } from '@/features/editor/extensions/extensions';

export interface DatabaseDescriptionPayload {
  json: JSONContent;
  text: string;
}

export const EMPTY_DESCRIPTION_DOC: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

/**
 * Приводит источник описания базы к валидному doc-JSON для Tiptap.
 *
 * JSON (`descriptionContent`) считается первичным источником.
 * Plain-text (`description`) используется только как fallback
 * для старых/частично заполненных данных.
 */
export function toDatabaseDescriptionDoc(
  richDescription?: unknown,
  plainDescription?: string | null,
): JSONContent {
  if (richDescription && typeof richDescription === 'object') {
    return richDescription as JSONContent;
  }

  const text = plainDescription?.trim();

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

/**
 * Единая точка построения payload для PATCH:
 * - `descriptionContent` (json) — каноничный источник;
 * - `description` (text) — производное поле для превью/поиска.
 */
export function buildDatabaseDescriptionPayload(
  json: JSONContent,
): DatabaseDescriptionPayload {
  const text = generateText(json, mainExtensions).trim();

  return {
    json,
    text,
  };
}

export function serializeDatabaseDescription(json: JSONContent): string {
  return JSON.stringify(json ?? EMPTY_DESCRIPTION_DOC);
}
