/**
 * Limits and timeouts for outbound external MCP servers.
 *
 * These live in code rather than the environment so the deployment contract
 * stays at two keys: AI_EXTERNAL_MCP_ENABLED and AI_MCP_ALLOWED_ORIGINS.
 */

/** Only Streamable HTTP is supported. stdio, legacy SSE, and WebSocket are not. */
export const AI_MCP_TRANSPORT = 'streamable-http' as const;

/** The single agent profile in version 1. Persisted so a second one is additive. */
export const AI_MCP_DEFAULT_PROFILE_KEY = 'default' as const;

/** Reserved prefix. Built-in AI tools must never use it. */
export const AI_MCP_TOOL_NAME_PREFIX = 'mcp__';

export const AI_MCP_NAMESPACE_PATTERN = /^[a-z][a-z0-9_]{0,23}$/;
export const AI_MCP_NAMESPACE_MAX_LENGTH = 24;
export const AI_MCP_TOOL_SLUG_MAX_LENGTH = 16;
export const AI_MCP_TOOL_HASH_LENGTH = 16;
/** 'mcp__'(5) + namespace(24) + '__'(2) + slug(16) + '_'(1) + hash(16) = 64. */
export const AI_MCP_TOOL_NAME_MAX_LENGTH = 64;

export const AI_MCP_SERVER_NAME_MAX_LENGTH = 200;
export const AI_MCP_URL_MAX_LENGTH = 2048;
export const AI_MCP_INSTRUCTIONS_MAX_LENGTH = 2000;
export const AI_MCP_MODEL_DESCRIPTION_MAX_LENGTH = 500;
export const AI_MCP_ALLOWED_ORIGINS_MAX_LENGTH = 4096;

export const AI_MCP_MAX_HEADERS = 20;
export const AI_MCP_MAX_HEADER_VALUE_BYTES = 8 * 1024;
export const AI_MCP_MAX_HEADERS_TOTAL_BYTES = 32 * 1024;

export const AI_MCP_MAX_SERVERS_PER_WORKSPACE = 20;
export const AI_MCP_MAX_DISCOVERED_TOOLS = 128;
export const AI_MCP_MAX_DISCOVERY_PAGES = 8;

export const AI_MCP_MAX_SCHEMA_BYTES = 8 * 1024;
export const AI_MCP_MAX_SCHEMA_DEPTH = 5;
export const AI_MCP_MAX_SCHEMA_NODES = 256;
export const AI_MCP_MAX_SCHEMA_PROPERTIES = 64;
export const AI_MCP_MAX_SCHEMA_ENUM_MEMBERS = 64;
export const AI_MCP_MAX_SCHEMA_STRING_LENGTH = 200;

export const AI_MCP_CONNECT_TIMEOUT_MS = 5_000;
/** Silence timeout, reset while the remote server reports progress. */
export const AI_MCP_IDLE_TIMEOUT_MS = 15_000;
/** Absolute ceiling for one tool call, regardless of progress reports. */
export const AI_MCP_TOTAL_TIMEOUT_MS = 30_000;
export const AI_MCP_PROBE_TOTAL_TIMEOUT_MS = 10_000;

export const AI_MCP_MAX_CACHED_CLIENTS = 32;
export const AI_MCP_IDLE_TTL_MS = 5 * 60_000;
export const AI_MCP_ABSOLUTE_TTL_MS = 30 * 60_000;

export const AI_MCP_MAX_WIRE_BYTES = 1024 * 1024;
export const AI_MCP_MAX_SNAPSHOT_BYTES = 64 * 1024;

export const AI_MCP_MAX_RUN_CONNECTIONS = 8;
export const AI_MCP_MAX_RUN_EXTERNAL_TOOLS = 32;
/**
 * Ceiling on built-in plus external definitions offered in one model turn. It
 * belongs here rather than in the tool registry because it bounds the merged
 * set, not the built-in set.
 */
export const AI_AGENT_MAX_TOOL_DEFINITIONS = 48;

export const AI_MCP_REDIS_INVALIDATION_CHANNEL = 'ai:mcp:invalidate';
