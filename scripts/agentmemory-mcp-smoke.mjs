import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MCP_SHIM_VERSION = '0.9.28';
const FALLBACK_URL = 'http://127.0.0.1:9';

function parseEnvFile(path) {
  const values = {};
  const source = readFileSync(path, 'utf8');
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function loopbackUrl() {
  const profile = parseEnvFile(join(homedir(), '.agentmemory', '.env'));
  const value = process.env.AGENTMEMORY_URL || profile.AGENTMEMORY_URL;
  const parsed = new URL(value);
  if (
    parsed.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname.toLowerCase())
  ) {
    throw new Error('AGENTMEMORY_URL must be loopback HTTP.');
  }
  return parsed.origin;
}

function shimEnvironment(url) {
  const env = {
    ...process.env,
    AGENTMEMORY_PROVIDER: 'noop',
    OPENAI_API_KEY_FOR_LLM: 'false',
    AGENTMEMORY_URL: url,
    AGENTMEMORY_TOOLS: 'core',
  };
  for (const name of [
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_MODEL',
    'ANTHROPIC_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'OPENROUTER_API_KEY',
    'MINIMAX_API_KEY',
    'VOYAGE_API_KEY',
    'COHERE_API_KEY',
  ]) {
    delete env[name];
  }
  return env;
}

function listTools(url) {
  return new Promise((resolvePromise, reject) => {
    const command =
      process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npx';
    const packageSpec = `@agentmemory/mcp@${MCP_SHIM_VERSION}`;
    const args =
      process.platform === 'win32'
        ? ['/d', '/s', '/c', `npx.cmd -y ${packageSpec}`]
        : ['-y', packageSpec];
    const child = spawn(command, args, {
      env: shimEnvironment(url),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error, tools) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      if (error) reject(error);
      else resolvePromise(tools);
    };
    const timeout = setTimeout(
      () => finish(new Error(`MCP smoke timed out. ${stderr.trim()}`)),
      30_000,
    );
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const handleMessage = (message) => {
      if (message.id === 1) {
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
      } else if (message.id === 2) {
        const tools = Array.isArray(message.result?.tools) ? message.result.tools : [];
        finish(null, tools.map((tool) => tool.name).sort());
      }
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      for (;;) {
        const newline = stdout.indexOf('\n');
        if (newline < 0) break;
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (!line) continue;
        try {
          handleMessage(JSON.parse(line));
        } catch {
          // Ignore non-JSON startup output; stderr is included in failures.
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => finish(error));
    child.on('exit', (code) => {
      if (!settled) finish(new Error(`MCP exited before tools/list (${code}). ${stderr.trim()}`));
    });
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'docmost-agentmemory-smoke', version: '1.0.0' },
      },
    });
  });
}

const serverUrl = loopbackUrl();
const [fallbackTools, serverTools] = await Promise.all([
  listTools(FALLBACK_URL),
  listTools(serverUrl),
]);
const extraTools = serverTools.filter((name) => !fallbackTools.includes(name));

console.log(
  `AgentMemory MCP shim ${MCP_SHIM_VERSION}: fallback=${fallbackTools.length}, server=${serverTools.length}.`,
);
if (fallbackTools.length === 0) {
  throw new Error('The autonomous MCP fallback exposed no tools.');
}
if (!serverTools.includes('memory_smart_search')) {
  throw new Error('The server-backed MCP surface is missing memory_smart_search.');
}
if (extraTools.length === 0 || serverTools.length <= fallbackTools.length) {
  throw new Error('The MCP shim did not expose a distinct server-backed tool surface.');
}
console.log(`AgentMemory MCP server-backed profile confirmed with ${extraTools.length} extra tools.`);
