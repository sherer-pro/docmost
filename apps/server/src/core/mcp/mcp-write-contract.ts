import { BadRequestException } from '@nestjs/common';
import {
  MCP_WRITE_CAPABILITIES,
  type AiBuiltinToolCatalogEntry,
} from '@docmost/api-contract';
import { MCP_IMAGE_MAX_BASE64 } from '../../common/config/mcp-body-limit';

const uuid = { type: 'string', format: 'uuid' } as const;
const hash = { type: 'string', pattern: '^[0-9a-f]{64}$' } as const;
const string = (maxLength: number) => ({ type: 'string', maxLength }) as const;

const definitions = {
  createPage: {
    description:
      'Create a page under an explicit parent, or at the space root.',
    target: { parentPageId: { anyOf: [uuid, { type: 'null' }] } },
    payload: { title: string(250) },
  },
  updatePageTitle: {
    description: 'Rename an existing page.',
    target: { pageId: uuid },
    payload: { title: string(250) },
  },
  editPageContent: {
    description:
      'Edit an identified text run, insert, replace or remove a text block, or append one Markdown block or attached image. Node IDs come from getOutline.',
    target: { pageId: uuid },
    payload: {
      edit: {
        type: 'object',
        oneOf: [
          editSchema('editText', {
            nodeId: string(128),
            oldText: string(4096),
            newText: string(4096),
          }),
          editSchema('replaceBlock', {
            nodeId: string(128),
            markdown: string(4096),
          }),
          editSchema('insertBlock', {
            nodeId: string(128),
            position: { enum: ['before', 'after'] },
            markdown: string(4096),
          }),
          editSchema('deleteBlock', { nodeId: string(128) }),
          editSchema('appendBlock', { markdown: string(4096) }),
          editSchema('appendImage', { attachmentId: uuid, alt: string(250) }),
        ],
      },
    },
  },
  uploadPageImage: {
    description:
      'Upload one page attachment as PNG, JPEG, GIF or WebP, up to 2 MiB. Submit canonical base64 and SHA-256.',
    target: { pageId: uuid },
    payload: {
      fileName: string(120),
      sha256: hash,
      base64: string(MCP_IMAGE_MAX_BASE64),
    },
  },
  replyToComment: {
    description: 'Add a plain-text reply to an existing root comment thread.',
    target: { pageId: uuid, threadId: uuid },
    payload: { text: string(4096) },
  },
  setCommentResolved: {
    description: 'Resolve or reopen an existing root comment thread.',
    target: { pageId: uuid, threadId: uuid },
    payload: { resolved: { type: 'boolean' } },
  },
} as const;

function editSchema(kind: string, properties: Record<string, unknown>) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['kind', ...Object.keys(properties)],
    properties: { kind: { const: kind }, ...properties },
  };
}

export type McpWriteToolName = keyof typeof definitions;

const hasOwn = (object: object, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(object, key);

export function isMcpWriteTool(name: string): name is McpWriteToolName {
  return hasOwn(definitions, name);
}

export const MCP_WRITE_TOOLS: Array<AiBuiltinToolCatalogEntry & {
  description: string;
  inputSchema: Record<string, unknown>;
}> = Object.entries(
  definitions,
).map(([name, tool], index) => ({
  name,
  description: `${tool.description} Inspect the target revision first. Preview the exact payload with expectedRevision and operationId. Commit with the same input and previewHash. Use status to recover a lost response.`,
  writeClass: 'write',
  exposures: ['mcp'],
  capability: MCP_WRITE_CAPABILITIES[index],
  category: 'mcp_write',
  targetScope: name === 'createPage' ? 'current_space' : 'readable_page',
  approvalMode: 'mcp_preview_revision',
  maxResultBytes: 24 * 1024,
  annotations: {
    idempotent: true,
    destructive: name === 'editPageContent',
    openWorld: false,
  },
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['mode', 'spaceId', ...Object.keys(tool.target)],
    properties: {
      mode: { enum: ['inspect', 'preview', 'commit', 'status'] },
      spaceId: uuid,
      ...tool.target,
      expectedRevision: hash,
      operationId: uuid,
      previewHash: hash,
      ...tool.payload,
    },
    oneOf: [
      { properties: { mode: { const: 'inspect' } } },
      { properties: { mode: { const: 'status' } }, required: ['operationId'] },
      {
        properties: { mode: { const: 'preview' } },
        required: [
          'expectedRevision',
          'operationId',
          ...Object.keys(tool.payload),
        ],
      },
      {
        properties: { mode: { const: 'commit' } },
        required: [
          'expectedRevision',
          'operationId',
          'previewHash',
          ...Object.keys(tool.payload),
        ],
      },
    ],
  },
}));

type Schema = {
  type?: string;
  enum?: readonly string[];
  const?: string;
  format?: string;
  pattern?: string;
  maxLength?: number;
  anyOf?: readonly Schema[];
  oneOf?: readonly Schema[];
  properties?: Readonly<Record<string, Schema>>;
  required?: readonly string[];
  additionalProperties?: boolean;
};

function matches(value: unknown, schema: Schema): boolean {
  if (schema.anyOf && !schema.anyOf.some((item) => matches(value, item)))
    return false;
  if (
    schema.oneOf &&
    schema.oneOf.filter((item) => matches(value, item)).length !== 1
  )
    return false;
  if (schema.enum && !schema.enum.some((item) => item === value)) return false;
  if (schema.const !== undefined && schema.const !== value) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'string') {
    if (typeof value !== 'string' || value.includes('\0')) return false;
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      return false;
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value))
      return false;
    if (
      schema.format === 'uuid' &&
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value)
    )
      return false;
  }
  if (schema.properties || schema.required) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false;
    const fields = value as Record<string, unknown>;
    if (schema.required?.some((key) => !hasOwn(fields, key))) return false;
    for (const [key, field] of Object.entries(fields)) {
      const property =
        schema.properties && hasOwn(schema.properties, key)
          ? schema.properties[key]
          : undefined;
      if (
        property
          ? !matches(field, property)
          : schema.additionalProperties === false
      )
        return false;
    }
  }
  return true;
}

type Edit =
  | { kind: 'editText'; nodeId: string; oldText: string; newText: string }
  | { kind: 'replaceBlock'; nodeId: string; markdown: string }
  | {
      kind: 'insertBlock';
      nodeId: string;
      position: 'before' | 'after';
      markdown: string;
    }
  | { kind: 'deleteBlock'; nodeId: string }
  | { kind: 'appendBlock'; markdown: string }
  | { kind: 'appendImage'; attachmentId: string; alt: string };

export type McpWriteInput = {
  mode: 'inspect' | 'status' | 'preview' | 'commit';
  spaceId: string;
  pageId?: string;
  parentPageId?: string | null;
  threadId?: string;
  expectedRevision?: string;
  operationId?: string;
  previewHash?: string;
  title?: string;
  edit?: Edit;
  fileName?: string;
  sha256?: string;
  base64?: string;
  text?: string;
  resolved?: boolean;
};

export function parseMcpWriteInput(
  tool: McpWriteToolName,
  raw: unknown,
): McpWriteInput {
  const schema = MCP_WRITE_TOOLS.find(({ name }) => name === tool)!.inputSchema;
  if (!matches(raw, schema))
    throw new BadRequestException('Invalid MCP write arguments');
  const input = raw as McpWriteInput;
  const fields = new Set([
    'mode',
    'spaceId',
    ...Object.keys(definitions[tool].target),
  ]);
  if (input.mode !== 'inspect') fields.add('operationId');
  if (input.mode === 'preview' || input.mode === 'commit') {
    fields.add('expectedRevision');
    for (const key of Object.keys(definitions[tool].payload)) fields.add(key);
  }
  if (input.mode === 'commit') fields.add('previewHash');
  if (Object.keys(input).some((key) => !fields.has(key))) {
    throw new BadRequestException('Unexpected fields for MCP write mode');
  }
  return input;
}
