import { createHash } from 'node:crypto';
import { serializeTemplateInstanceContentForHash } from '@docmost/editor-ext/server';

export function hashPageTemplateInstanceContent(content: unknown): string {
  return createHash('sha256')
    .update(serializeTemplateInstanceContentForHash(content))
    .digest('hex');
}
