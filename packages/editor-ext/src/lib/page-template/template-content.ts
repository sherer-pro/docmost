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

export function normalizeTemplateDraft(
  input: unknown,
  createId: () => string = defaultId,
): JSONContent {
  const document = asDocument(input);
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

export function summarizeTemplateDiff(
  previousPublished: unknown,
  nextDraft: unknown,
): TemplateDiffSummary {
  const previous = normalizeTemplateDraft(previousPublished, defaultId);
  const next = normalizeTemplateDraft(nextDraft, defaultId);
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
  const previousOrder = nodeOrder(previous);
  const nextOrder = nodeOrder(next);

  return {
    addedBlockIds: missingKeys(nextManaged, previousManaged),
    removedBlockIds: missingKeys(previousManaged, nextManaged),
    movedBlockIds: [...previousOrder.entries()]
      .filter(
        ([id, position]) => nextOrder.has(id) && nextOrder.get(id) !== position,
      )
      .map(([id]) => id),
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

function nodeOrder(document: JSONContent): Map<string, number> {
  const result = new Map<string, number>();
  (document.content ?? []).forEach((node, index) => {
    const id =
      node.type === TEMPLATE_MANAGED_BLOCK_TYPE
        ? asString(node.attrs?.templateBlockId)
        : node.type === TEMPLATE_FIELD_TYPE
          ? asString(node.attrs?.fieldId)
          : null;
    if (id) result.set(id, index);
  });
  return result;
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
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`;
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
