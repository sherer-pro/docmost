import { createHash } from 'node:crypto';
import {
  AI_MCP_MAX_SCHEMA_BYTES,
  AI_MCP_MAX_SCHEMA_DEPTH,
  AI_MCP_MAX_SCHEMA_ENUM_MEMBERS,
  AI_MCP_MAX_SCHEMA_NODES,
  AI_MCP_MAX_SCHEMA_PROPERTIES,
  AI_MCP_NAMESPACE_PATTERN,
  AI_MCP_TOOL_HASH_LENGTH,
  AI_MCP_TOOL_NAME_MAX_LENGTH,
  AI_MCP_TOOL_NAME_PREFIX,
  AI_MCP_TOOL_SLUG_MAX_LENGTH,
} from './ai-mcp.constants';

/**
 * Structural JSON Schema keywords kept verbatim.
 *
 * This is an allowlist on purpose. A denylist would silently pass any future
 * keyword that carries free-form prose, which is the tool-poisoning vector this
 * function exists to close.
 */
const ALLOWED_SCHEMA_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'items',
  'prefixItems',
  'enum',
  'const',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'anyOf',
  'oneOf',
  'allOf',
  'not',
  'format',
  'nullable',
]);

/** Keywords whose value is itself a schema. */
const SUBSCHEMA_KEYWORDS = new Set(['items', 'not']);

/** Keywords whose value is an array of schemas. */
const SUBSCHEMA_ARRAY_KEYWORDS = new Set([
  'anyOf',
  'oneOf',
  'allOf',
  'prefixItems',
]);

const ALLOWED_FORMATS = new Set([
  'date',
  'date-time',
  'time',
  'duration',
  'email',
  'hostname',
  'ipv4',
  'ipv6',
  'uri',
  'uri-reference',
  'uuid',
]);

const JSON_TYPES = new Set([
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null',
]);

export type AiMcpSanitizedSchema = Record<string, unknown>;

export type AiMcpArgumentNameMap = {
  properties?: Record<
    string,
    { remoteName: string; value: AiMcpArgumentNameMap }
  >;
  items?: AiMcpArgumentNameMap;
  branches?: AiMcpArgumentNameMap[];
  prefixItems?: AiMcpArgumentNameMap[];
};

export type AiMcpSanitizedInputSchema = {
  inputSchema: AiMcpSanitizedSchema;
  argumentNameMap: AiMcpArgumentNameMap;
};

type SanitizeBudget = { nodes: number };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value)
  );
}

function sanitizeScalar(value: unknown): unknown | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'boolean' || value === null) {
    return value;
  }
  return undefined;
}

function sanitizeTypeKeyword(value: unknown): unknown | undefined {
  if (typeof value === 'string') {
    return JSON_TYPES.has(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    const types = value.filter(
      (entry): entry is string =>
        typeof entry === 'string' && JSON_TYPES.has(entry),
    );
    return types.length > 0 ? types : undefined;
  }
  return undefined;
}

function sanitizeNode(
  node: unknown,
  depth: number,
  budget: SanitizeBudget,
): { schema: AiMcpSanitizedSchema; map: AiMcpArgumentNameMap } | null {
  if (!isPlainObject(node) || depth > AI_MCP_MAX_SCHEMA_DEPTH) {
    return null;
  }
  budget.nodes += 1;
  if (budget.nodes > AI_MCP_MAX_SCHEMA_NODES) {
    return null;
  }

  const result: AiMcpSanitizedSchema = {};
  const argumentNameMap: AiMcpArgumentNameMap = {};

  const rawProperties = isPlainObject(node.properties)
    ? node.properties
    : null;
  const propertyAliases = new Map<string, string>();
  if (rawProperties) {
    const properties: Record<string, AiMcpSanitizedSchema> = {};
    const mappings: NonNullable<AiMcpArgumentNameMap['properties']> = {};
    let count = 0;
    for (const [propertyName, propertySchema] of Object.entries(rawProperties)) {
      if (count >= AI_MCP_MAX_SCHEMA_PROPERTIES) {
        break;
      }
      const sanitized = sanitizeNode(propertySchema, depth + 1, budget);
      if (!sanitized) {
        continue;
      }
      const alias = `arg_${createHash('sha256')
        .update(propertyName, 'utf8')
        .digest('hex')
        .slice(0, 16)}`;
      if (mappings[alias] && mappings[alias].remoteName !== propertyName) {
        return null;
      }
      properties[alias] = sanitized.schema;
      mappings[alias] = { remoteName: propertyName, value: sanitized.map };
      propertyAliases.set(propertyName, alias);
      count += 1;
    }
    if (count > 0) {
      result.properties = properties;
      argumentNameMap.properties = mappings;
    }
  }

  for (const [key, value] of Object.entries(node)) {
    // Rejecting $ref and $defs removes recursion entirely, and with it the
    // whole class of depth bombs and reference cycles.
    if (!ALLOWED_SCHEMA_KEYWORDS.has(key)) {
      continue;
    }

    if (key === 'type') {
      const type = sanitizeTypeKeyword(value);
      if (type !== undefined) {
        result.type = type;
      }
      continue;
    }

    if (key === 'format') {
      if (typeof value === 'string' && ALLOWED_FORMATS.has(value)) {
        result.format = value;
      }
      continue;
    }

    if (key === 'properties') {
      continue;
    }

    if (key === 'required') {
      if (Array.isArray(value)) {
        const required = value
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => propertyAliases.get(entry))
          .filter((entry): entry is string => entry !== undefined);
        if (required.length > 0) {
          result.required = required;
        }
      }
      continue;
    }

    if (SUBSCHEMA_KEYWORDS.has(key)) {
      if (typeof value === 'boolean') {
        result[key] = value;
        continue;
      }
      const sanitized = sanitizeNode(value, depth + 1, budget);
      if (sanitized) {
        result[key] = sanitized.schema;
        if (key === 'items') {
          argumentNameMap.items = sanitized.map;
        }
      }
      continue;
    }

    if (SUBSCHEMA_ARRAY_KEYWORDS.has(key)) {
      if (!Array.isArray(value)) {
        continue;
      }
      const branches = value
        .map((entry) => sanitizeNode(entry, depth + 1, budget))
        .filter(
          (
            entry,
          ): entry is {
            schema: AiMcpSanitizedSchema;
            map: AiMcpArgumentNameMap;
          } => entry !== null,
        );
      if (branches.length > 0) {
        result[key] = branches.map((branch) => branch.schema);
        if (key === 'prefixItems') {
          argumentNameMap.prefixItems = branches.map((branch) => branch.map);
        } else {
          argumentNameMap.branches = [
            ...(argumentNameMap.branches ?? []),
            ...branches.map((branch) => branch.map),
          ];
        }
      }
      continue;
    }

    if (key === 'enum') {
      if (!Array.isArray(value)) {
        continue;
      }
      const members = value
        .slice(0, AI_MCP_MAX_SCHEMA_ENUM_MEMBERS)
        .map((entry) => sanitizeScalar(entry))
        .filter((entry) => entry !== undefined);
      if (members.length > 0) {
        result.enum = members;
      }
      continue;
    }

    const scalar = sanitizeScalar(value);
    if (scalar !== undefined) {
      result[key] = scalar;
    }
  }

  if (result.type === 'object' || result.properties) {
    // Dynamic keys cannot be safely mapped back to remote names and would let
    // the model send arguments outside the reviewed contract.
    result.additionalProperties = false;
  }

  return { schema: result, map: argumentNameMap };
}

/**
 * Rebuilds a remote input schema from structural keywords only.
 *
 * Every free-form field a remote server could use to address the model is
 * dropped: `description`, `title`, `$comment`, `examples`, and `default`.
 * `default` is dropped deliberately - a `default` string renders verbatim into
 * the schema the model sees, and no tool needs one to be callable.
 *
 * Returns `null` when the schema cannot be represented safely, in which case
 * the tool must not be approved.
 */
export function sanitizeAiMcpInputSchema(
  schema: unknown,
): AiMcpSanitizedSchema | null {
  return sanitizeAiMcpInputSchemaWithMapping(schema)?.inputSchema ?? null;
}

export function sanitizeAiMcpInputSchemaWithMapping(
  schema: unknown,
): AiMcpSanitizedInputSchema | null {
  const sanitized = sanitizeNode(schema, 0, { nodes: 0 });
  if (!sanitized) {
    return null;
  }
  // A tool call always sends an argument object, so the root must be one.
  if (sanitized.schema.type !== 'object') {
    return null;
  }
  if (!sanitized.schema.properties) {
    sanitized.schema.properties = {};
    sanitized.schema.additionalProperties = false;
  }
  if (Buffer.byteLength(JSON.stringify(sanitized.schema), 'utf8') >
    AI_MCP_MAX_SCHEMA_BYTES) {
    return null;
  }
  return {
    inputSchema: sanitized.schema,
    argumentNameMap: sanitized.map,
  };
}

export function remapAiMcpArguments(
  value: unknown,
  mapping: AiMcpArgumentNameMap,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      remapAiMcpArguments(
        entry,
        mapping.prefixItems?.[index] ?? mapping.items ?? {},
      ),
    );
  }
  if (!isPlainObject(value)) {
    return value;
  }

  const candidates = [mapping, ...(mapping.branches ?? [])];
  const propertyMappings = Object.assign(
    {},
    ...candidates.map((candidate) => candidate.properties ?? {}),
  ) as NonNullable<AiMcpArgumentNameMap['properties']>;
  const remapped: Record<string, unknown> = {};
  for (const [alias, entry] of Object.entries(value)) {
    const property = propertyMappings[alias];
    if (!property) {
      continue;
    }
    remapped[property.remoteName] = remapAiMcpArguments(entry, property.value);
  }
  return remapped;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = canonicalize(value[key]);
        return accumulator;
      }, {});
  }
  return value;
}

/**
 * Stable identity of an approved tool definition.
 *
 * A changed fingerprint invalidates the workspace approval, so a remote server
 * cannot alter a tool's contract after an administrator has reviewed it.
 */
export function fingerprintAiMcpTool(
  remoteName: string,
  schema: unknown,
): string {
  const canonical = JSON.stringify(canonicalize({ remoteName, schema }));
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function isValidAiMcpNamespace(value: string): boolean {
  return AI_MCP_NAMESPACE_PATTERN.test(value);
}

export function toAiMcpToolSlug(remoteName: string): string {
  return remoteName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, AI_MCP_TOOL_SLUG_MAX_LENGTH)
    .replace(/_+$/g, '');
}

/**
 * Builds the internal tool name for a remote tool.
 *
 * `mcp__<namespace>__<slug>_<hash16>`, at most 64 characters. Discovery also
 * rejects an actual collision, so a hash collision can never silently alias a
 * second remote capability.
 */
export function buildAiMcpToolName(
  namespace: string,
  remoteName: string,
): string {
  const slug = toAiMcpToolSlug(remoteName) || 'tool';
  const hash = createHash('sha256')
    .update(remoteName, 'utf8')
    .digest('hex')
    .slice(0, AI_MCP_TOOL_HASH_LENGTH);
  return `${AI_MCP_TOOL_NAME_PREFIX}${namespace}__${slug}_${hash}`;
}

export type ParsedAiMcpToolName = {
  namespace: string;
  slug: string;
  hash: string;
};

export function parseAiMcpToolName(
  toolName: string,
): ParsedAiMcpToolName | null {
  if (
    !toolName.startsWith(AI_MCP_TOOL_NAME_PREFIX) ||
    toolName.length > AI_MCP_TOOL_NAME_MAX_LENGTH
  ) {
    return null;
  }
  const rest = toolName.slice(AI_MCP_TOOL_NAME_PREFIX.length);
  const separator = rest.indexOf('__');
  if (separator <= 0) {
    return null;
  }
  const namespace = rest.slice(0, separator);
  const tail = rest.slice(separator + 2);
  if (!isValidAiMcpNamespace(namespace)) {
    return null;
  }
  // Underscores separate slug segments and never double up, so a non-canonical
  // name such as mcp__ns__a__b_<hash> is rejected rather than silently accepted.
  const match = tail.match(
    new RegExp(
      `^([a-z0-9]+(?:_[a-z0-9]+)*)_([0-9a-f]{${AI_MCP_TOOL_HASH_LENGTH}})$`,
    ),
  );
  if (!match) {
    return null;
  }
  const [, slug, hash] = match;
  if (slug.length > AI_MCP_TOOL_SLUG_MAX_LENGTH) {
    return null;
  }
  return { namespace, slug, hash };
}

export function isAiMcpToolName(toolName: string): boolean {
  return parseAiMcpToolName(toolName) !== null;
}
