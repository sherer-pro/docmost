import type { JSONContent } from '@tiptap/core';

export const TEMPLATE_MANAGED_BLOCK_TYPE = 'templateManagedBlock';
export const TEMPLATE_FIELD_TYPE = 'templateField';

export type TemplateDiffSummary = {
  addedBlockIds: string[];
  removedBlockIds: string[];
  movedBlockIds: string[];
  changedBlockIds: string[];
  addedFields: TemplateFieldSummary[];
  removedFields: TemplateFieldSummary[];
  renamedFields: Array<{
    fieldId: string;
    previousLabel: string;
    nextLabel: string;
  }>;
};

export type TemplateFieldSummary = {
  fieldId: string;
  label: string;
  placeholder: string;
};

export function serializeTemplateDraftSeed(input: unknown): string {
  return stableJson(stripNoopTemplateAttributes(input));
}

export function serializeTemplateInstanceContentForHash(
  input: unknown,
): string {
  return stableJson(stripTemplateInstanceHashAttributes(input));
}

export function formatTemplateDraftId(hexDigest: string): string {
  const hex = hexDigest.slice(0, 32);
  if (!/^[a-f0-9]{32}$/i.test(hex)) {
    throw new Error('template_draft_digest_invalid');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function normalizeTemplateDraft(
  input: unknown,
  createId: () => string = defaultId,
): JSONContent {
  const document = asDocument(stripNoopTemplateAttributes(input));
  const usedIds = new Set<string>();
  const normalizedContent = (document.content ?? []).map((node) => {
    if (node.type === TEMPLATE_MANAGED_BLOCK_TYPE) {
      return {
        ...clone(node),
        attrs: {
          ...(node.attrs ?? {}),
          templateBlockId: takeUniqueId(
            node.attrs?.templateBlockId,
            usedIds,
            createId,
          ),
          locked: false,
        },
        content: unwrapTemplateContainers(node.content ?? []),
      };
    }
    if (node.type === TEMPLATE_FIELD_TYPE) {
      return {
        ...clone(node),
        attrs: {
          ...(node.attrs ?? {}),
          fieldId: takeUniqueId(node.attrs?.fieldId, usedIds, createId),
        },
        content: unwrapTemplateContainers(node.content ?? []),
      };
    }
    return {
      type: TEMPLATE_MANAGED_BLOCK_TYPE,
      attrs: {
        templateBlockId: takeUniqueId(null, usedIds, createId),
        locked: false,
      },
      content: unwrapTemplateContainers([node]),
    };
  });
  const meaningfulContent = normalizedContent.filter(
    (node) => !isEmptyManagedBlock(node),
  );
  return {
    ...document,
    content:
      meaningfulContent.length > 0
        ? meaningfulContent
        : normalizedContent.slice(0, 1),
  };
}

export function createTemplateInstanceContent(
  published: unknown,
  currentInstance?: unknown,
  createId: () => string = defaultId,
): JSONContent {
  const normalized = normalizeTemplateDraft(published, createId);
  const currentFields = collectTemplateFields(currentInstance);
  return {
    ...normalized,
    content: (normalized.content ?? []).map((node) => {
      if (node.type === TEMPLATE_FIELD_TYPE) {
        const fieldId = asString(node.attrs?.fieldId);
        const current = fieldId ? currentFields.get(fieldId) : undefined;
        return {
          ...clone(node),
          content: clone(current?.content ?? node.content ?? []),
        };
      }
      return {
        ...clone(node),
        attrs: { ...(node.attrs ?? {}), locked: true },
      };
    }),
  };
}

export function detachTemplateContent(input: unknown): JSONContent {
  const document = asDocument(input);
  const content = unwrapTemplateContainers(document.content ?? []);
  return {
    ...document,
    content: content.length > 0 ? content : [{ type: 'paragraph' }],
  };
}

export function collectTemplateFields(
  input: unknown,
): Map<string, JSONContent> {
  const result = new Map<string, JSONContent>();
  const document = asDocument(input);
  for (const node of document.content ?? []) {
    if (node.type !== TEMPLATE_FIELD_TYPE) continue;
    const id = asString(node.attrs?.fieldId);
    if (id) result.set(id, clone(node));
  }
  return result;
}

export function isTemplateFieldFilled(node: JSONContent | undefined): boolean {
  if (!node) return false;
  return (node.content ?? []).some(hasMeaningfulContent);
}

export function validateTemplateInstanceMutation(
  previous: unknown,
  next: unknown,
): boolean {
  const previousDocument = asDocument(previous);
  const nextDocument = asDocument(next);
  if (!hasOnlyTemplateContainers(previousDocument)) return false;
  if (!hasOnlyTemplateContainers(nextDocument)) return false;
  return (
    stableJson(templateSkeleton(previousDocument)) ===
    stableJson(templateSkeleton(nextDocument))
  );
}

export function assertNormalizedTemplateDraft(input: unknown): JSONContent {
  const document = asDocument(input);
  const usedIds = new Set<string>();
  for (const node of document.content ?? []) {
    const id =
      node.type === TEMPLATE_MANAGED_BLOCK_TYPE
        ? asString(node.attrs?.templateBlockId)
        : node.type === TEMPLATE_FIELD_TYPE
          ? asString(node.attrs?.fieldId)
          : null;
    if (!id || usedIds.has(id)) {
      throw new Error('template_diff_requires_normalized_draft');
    }
    usedIds.add(id);
  }
  return document;
}

export function summarizeTemplateDiff(
  previousPublished: unknown,
  nextDraft: unknown,
): TemplateDiffSummary {
  const previous = assertNormalizedTemplateDraft(previousPublished);
  const next = assertNormalizedTemplateDraft(nextDraft);
  const previousManaged = keyedNodes(
    previous,
    TEMPLATE_MANAGED_BLOCK_TYPE,
    'templateBlockId',
  );
  const nextManaged = keyedNodes(
    next,
    TEMPLATE_MANAGED_BLOCK_TYPE,
    'templateBlockId',
  );
  const previousFields = keyedNodes(previous, TEMPLATE_FIELD_TYPE, 'fieldId');
  const nextFields = keyedNodes(next, TEMPLATE_FIELD_TYPE, 'fieldId');

  return {
    addedBlockIds: missingKeys(nextManaged, previousManaged),
    removedBlockIds: missingKeys(previousManaged, nextManaged),
    movedBlockIds: movedKeys(previousManaged, nextManaged),
    changedBlockIds: changedKeys(previousManaged, nextManaged),
    addedFields: missingKeys(nextFields, previousFields).map((fieldId) =>
      summarizeField(fieldId, nextFields.get(fieldId)),
    ),
    removedFields: missingKeys(previousFields, nextFields).map((fieldId) =>
      summarizeField(fieldId, previousFields.get(fieldId)),
    ),
    renamedFields: [...previousFields.entries()].flatMap(([fieldId, node]) => {
      const nextNode = nextFields.get(fieldId);
      if (!nextNode) return [];
      const previousLabel = asString(node.attrs?.label) ?? '';
      const nextLabel = asString(nextNode.attrs?.label) ?? '';
      return previousLabel === nextLabel
        ? []
        : [{ fieldId, previousLabel, nextLabel }];
    }),
  };
}

function templateSkeleton(document: JSONContent): JSONContent {
  return {
    type: document.type,
    content: (document.content ?? []).map((node) => {
      if (node.type === TEMPLATE_FIELD_TYPE) {
        return { ...clone(node), content: [{ type: '__templateFieldValue' }] };
      }
      return clone(node);
    }),
  };
}

function hasOnlyTemplateContainers(document: JSONContent): boolean {
  const usedIds = new Set<string>();
  return (document.content ?? []).every((node) => {
    const id =
      node.type === TEMPLATE_MANAGED_BLOCK_TYPE
        ? asString(node.attrs?.templateBlockId)
        : node.type === TEMPLATE_FIELD_TYPE
          ? asString(node.attrs?.fieldId)
          : null;
    if (!id || usedIds.has(id) || containsTemplateContainer(node.content)) {
      return false;
    }
    usedIds.add(id);
    return true;
  });
}

function containsTemplateContainer(
  content: JSONContent[] | undefined,
): boolean {
  return (content ?? []).some(
    (node) =>
      node.type === TEMPLATE_MANAGED_BLOCK_TYPE ||
      node.type === TEMPLATE_FIELD_TYPE ||
      containsTemplateContainer(node.content),
  );
}

function unwrapTemplateContainers(content: JSONContent[]): JSONContent[] {
  return content.flatMap((node) => {
    if (
      node.type === TEMPLATE_MANAGED_BLOCK_TYPE ||
      node.type === TEMPLATE_FIELD_TYPE
    ) {
      return unwrapTemplateContainers(node.content ?? []);
    }
    const next = clone(node);
    if (Array.isArray(next.content)) {
      next.content = unwrapTemplateContainers(next.content);
    }
    return [next];
  });
}

function takeUniqueId(
  preferred: unknown,
  usedIds: Set<string>,
  createId: () => string,
): string {
  const preferredId = asString(preferred);
  if (preferredId && !usedIds.has(preferredId)) {
    usedIds.add(preferredId);
    return preferredId;
  }

  let candidate = asString(createId()) ?? defaultId();
  while (usedIds.has(candidate)) {
    candidate = asString(createId()) ?? defaultId();
  }
  usedIds.add(candidate);
  return candidate;
}

function keyedNodes(
  document: JSONContent,
  type: string,
  attribute: string,
): Map<string, JSONContent> {
  const result = new Map<string, JSONContent>();
  for (const node of document.content ?? []) {
    if (node.type !== type) continue;
    const id = asString(node.attrs?.[attribute]);
    if (id) result.set(id, clone(node));
  }
  return result;
}

function missingKeys(
  source: Map<string, JSONContent>,
  target: Map<string, JSONContent>,
): string[] {
  return [...source.keys()].filter((id) => !target.has(id));
}

function changedKeys(
  previous: Map<string, JSONContent>,
  next: Map<string, JSONContent>,
): string[] {
  return [...previous.entries()].flatMap(([id, node]) => {
    const nextNode = next.get(id);
    return nextNode && stableJson(node) !== stableJson(nextNode) ? [id] : [];
  });
}

function movedKeys(
  previous: Map<string, JSONContent>,
  next: Map<string, JSONContent>,
): string[] {
  const nextPositions = new Map(
    [...next.keys()].map((id, index) => [id, index] as const),
  );
  const commonIds = [...previous.keys()].filter((id) => nextPositions.has(id));
  const positions = commonIds.map((id) => nextPositions.get(id)!);
  const tails: number[] = [];
  const tailIndices: number[] = [];
  const predecessors = positions.map(() => -1);

  positions.forEach((position, index) => {
    let left = 0;
    let right = tails.length;
    while (left < right) {
      const middle = Math.floor((left + right) / 2);
      if (tails[middle] < position) left = middle + 1;
      else right = middle;
    }
    if (left > 0) predecessors[index] = tailIndices[left - 1];
    tails[left] = position;
    tailIndices[left] = index;
  });

  const unchangedIndices = new Set<number>();
  let current = tailIndices[tails.length - 1] ?? -1;
  while (current >= 0) {
    unchangedIndices.add(current);
    current = predecessors[current];
  }
  return commonIds.filter((_, index) => !unchangedIndices.has(index));
}

function summarizeField(
  fieldId: string,
  node: JSONContent | undefined,
): TemplateFieldSummary {
  return {
    fieldId,
    label: asString(node?.attrs?.label) ?? '',
    placeholder: asString(node?.attrs?.placeholder) ?? '',
  };
}

function hasMeaningfulContent(node: JSONContent): boolean {
  if (typeof node.text === 'string' && node.text.trim().length > 0) return true;
  if (node.type && !['doc', 'paragraph', 'text'].includes(node.type)) {
    if (!node.content || node.content.length === 0) return true;
  }
  return (node.content ?? []).some(hasMeaningfulContent);
}

function isEmptyManagedBlock(node: JSONContent): boolean {
  return (
    node.type === TEMPLATE_MANAGED_BLOCK_TYPE &&
    Boolean(node.content?.length) &&
    node.content!.every(
      (child) => child.type === 'paragraph' && !child.content?.length,
    )
  );
}

function asDocument(input: unknown): JSONContent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { type: 'doc', content: [] };
  }
  const document = clone(input as JSONContent);
  return {
    ...document,
    type: document.type === 'doc' ? 'doc' : 'doc',
    content: Array.isArray(document.content) ? document.content : [],
  };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`;
}

function stripNoopTemplateAttributes(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripNoopTemplateAttributes);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
      if (key !== 'attrs' || !item || typeof item !== 'object') {
        return [[key, stripNoopTemplateAttributes(item)]];
      }
      const attrs = Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .filter(
            ([, attribute]) => attribute !== null && attribute !== undefined,
          )
          .map(([attribute, attributeValue]) => [
            attribute,
            stripNoopTemplateAttributes(attributeValue),
          ]),
      );
      return Object.keys(attrs).length > 0 ? [[key, attrs]] : [];
    }),
  );
}

function stripTemplateInstanceHashAttributes(value: unknown): unknown {
  const stripped = stripNoopTemplateAttributes(value);
  if (Array.isArray(stripped)) {
    return stripped.map(stripTemplateInstanceHashAttributes);
  }
  if (!stripped || typeof stripped !== 'object') {
    return stripped;
  }

  const node = stripped as Record<string, unknown>;
  const nodeType = typeof node.type === 'string' ? node.type : '';
  const attrs =
    node.attrs && typeof node.attrs === 'object'
      ? (node.attrs as Record<string, unknown>)
      : null;
  const normalizedAttrs = attrs
    ? Object.fromEntries(
        Object.entries(attrs).filter(
          ([key]) =>
            key !== 'id' ||
            ![
              'paragraph',
              'heading',
              'transclusionSource',
              'pageEmbed',
            ].includes(nodeType),
        ),
      )
    : null;

  return Object.fromEntries(
    Object.entries(node).flatMap(([key, item]) => {
      if (key === 'attrs') {
        return normalizedAttrs && Object.keys(normalizedAttrs).length > 0
          ? [[key, normalizedAttrs]]
          : [];
      }
      return [[key, stripTemplateInstanceHashAttributes(item)]];
    }),
  );
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function defaultId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `template-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}
