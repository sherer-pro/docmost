import { validate as isUuid } from 'uuid';

export function pageAttachmentUsages(input: unknown): Map<string, string[]> {
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      return new Map();
    }
  }
  const result = new Map<string, string[]>();
  const stack: Array<{ node: any; block?: string }> = [{ node: input }];
  while (stack.length) {
    const { node, block } = stack.pop()!;
    if (!node || typeof node !== 'object') continue;
    const current =
      typeof node.attrs?.id === 'string' && node.attrs.id.length <= 128
        ? node.attrs.id
        : block;
    const rawId = node.attrs?.attachmentId;
    if (typeof rawId === 'string' && isUuid(rawId)) {
      const id = rawId.toLowerCase();
      const positions = result.get(id) ?? [];
      positions.push(current ?? '');
      result.set(id, positions);
    }
    for (const child of Array.isArray(node.content) ? node.content : [])
      stack.push({ node: child, block: current });
  }
  return result;
}
