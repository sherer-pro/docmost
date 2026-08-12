import { spawn } from 'node:child_process';

const env = {
  ...process.env,
  AGENTMEMORY_PROVIDER: 'noop',
  OPENAI_API_KEY_FOR_LLM: 'false',
  AGENTMEMORY_URL: 'http://127.0.0.1:3111',
  AGENTMEMORY_TOOLS: 'all',
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
]) {
  delete env[name];
}

const command = process.platform === 'win32' ? process.env.ComSpec : 'npx';
const args =
  process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npx.cmd -y @agentmemory/mcp']
    : ['-y', '@agentmemory/mcp'];
const child = spawn(command, args, {
  env,
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

let stdout = '';
let stderr = '';
let initialized = false;

const timeout = setTimeout(() => {
  console.error(`MCP smoke timed out. ${stderr.trim()}`);
  child.kill();
  process.exitCode = 1;
}, 30_000);

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function handleMessage(message) {
  if (message.id === 1 && !initialized) {
    initialized = true;
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    return;
  }
  if (message.id !== 2) return;

  clearTimeout(timeout);
  const tools = Array.isArray(message.result?.tools) ? message.result.tools : [];
  console.log(`AgentMemory MCP exposed ${tools.length} tools from the running server.`);
  if (tools.length !== 8) {
    console.error(
      'Expected the 8-tool core surface from the running server; the autonomous fallback exposes 7 tools.',
    );
    process.exitCode = 1;
  }
  child.kill();
}

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
      // Ignore non-JSON startup output on stdout; stderr is reported on failure.
    }
  }
});

child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

child.on('error', (error) => {
  clearTimeout(timeout);
  console.error(`Unable to start AgentMemory MCP: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code) => {
  if (!initialized && process.exitCode !== 1) {
    clearTimeout(timeout);
    console.error(`AgentMemory MCP exited before initialization (${code}). ${stderr.trim()}`);
    process.exitCode = 1;
  }
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
