import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { finished } from 'node:stream/promises';
import { promisify } from 'node:util';
import { sanitizeLogText } from '../../../scripts/sanitize-ci-log-stream.mjs';
import {
  applicationAuditCommand,
  createApplicationLogScanService,
} from '../../../scripts/ai-application-log-scan.mjs';
import { request } from '../../client/e2e/database/api-context.mjs';

const repo = path.resolve(import.meta.dirname, '../../..');
const exec = promisify(execFile);

export async function runReleaseAcceptance({
  baseURL,
  collabURL,
  report,
  output,
  exactSecrets,
  scanApplicationLogs,
  auditMode = 'release',
}) {
  const command = applicationAuditCommand(auditMode);
  assert.equal(
    typeof scanApplicationLogs,
    'function',
    'Native application log scan callback is required',
  );
  assert.equal(
    process.versions.node.split('.')[0],
    '22',
    'Release acceptance requires Node 22',
  );
  const origin = new URL(baseURL);
  assert.equal(
    origin.hostname,
    '127.0.0.1',
    'Release acceptance requires the isolated loopback runtime',
  );
  const api = await request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL, Referer: `${baseURL}/` },
  });
  let authToken;
  let csrfToken;
  try {
    const password = `Aa1!${randomBytes(24).toString('base64url')}`;
    exactSecrets.add(password);
    const setup = await api.post('/api/auth/setup', {
      data: {
        name: 'Release QA Administrator',
        email: 'release-qa@example.test',
        password,
        workspaceName: 'Isolated release acceptance',
        hostname: `releaseqa${Date.now()}`,
      },
    });
    assert(setup.ok(), `Isolated release setup returned ${setup.status()}`);
    const { cookies } = await api.storageState();
    authToken = cookies.find((cookie) => cookie.name === 'authToken')?.value;
    csrfToken = cookies.find((cookie) => cookie.name === 'csrfToken')?.value;
    assert(
      authToken && csrfToken,
      'Release setup did not issue authentication cookies',
    );
    exactSecrets.add(authToken);
    exactSecrets.add(csrfToken);
  } finally {
    await api.dispose();
  }

  const auditRoot = path.join(
    output,
    auditMode === 'release' ? 'release' : 'ai-browser-diagnostic',
  );
  await mkdir(auditRoot, { recursive: true });
  const env = Object.fromEntries(
    [
      'PATH',
      'Path',
      'SystemRoot',
      'WINDIR',
      'TEMP',
      'TMP',
      'USERPROFILE',
      'COMSPEC',
      'ComSpec',
      'PATHEXT',
      'ProgramFiles',
      'ProgramFiles(x86)',
      'HOME',
    ]
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
  const pathKey =
    Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  env[pathKey] =
    `${path.dirname(process.execPath)}${path.delimiter}${env[pathKey] ?? ''}`;
  Object.assign(env, {
    JEST_MAX_WORKERS: '2',
    NX_DAEMON: 'false',
    DOCMOST_BASE_URL: baseURL,
    DOCMOST_API_BASE_URL: baseURL,
    DOCMOST_API_ORIGIN: baseURL,
    DOCMOST_WEBKIT_BASE_URL: baseURL,
    DOCMOST_AUTH_TOKEN: authToken,
    DOCMOST_CSRF_TOKEN: csrfToken,
    DOCMOST_AI_MOCK_PORT: '1080',
    DOCMOST_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:1080/v1',
    DOCMOST_AI_CONTEXT_MODEL_PORT: '1080',
    DOCMOST_AI_CONTEXT_MODEL_PROVIDER_URL: 'http://127.0.0.1:1080/v1',
    DOCMOST_AI_CONTEXT_RETRIEVAL_URL: 'http://127.0.0.1:1080/retrieval',
    DOCMOST_AI_CONTEXT_COLLAB_URL: collabURL,
    DOCMOST_COLLAB_STATS_URL: new URL('/api/collab/stats', collabURL).href,
    DOCMOST_DRAWIO_AUDIT_URL: 'https://embed.diagrams.net',
    DOCMOST_AI_AUDIT_ROOT: path.join(auditRoot, 'ai'),
    DOCMOST_AI_AGENT_AUDIT_ROOT: path.join(auditRoot, 'agent'),
    DOCMOST_EDITOR_AUDIT_ROOT: path.join(auditRoot, 'editor'),
    DOCMOST_AI_CONTEXT_AUDIT_ROOT: path.join(auditRoot, 'context'),
  });
  for (const name of [
    'DOCMOST_AI_AGENT_DEFAULT_SUBNET',
    'DOCMOST_AI_AGENT_EDGE_SUBNET',
  ]) {
    if (process.env[name]?.trim()) env[name] = process.env[name].trim();
  }
  const sourceRevision = (
    await exec('git', ['rev-parse', 'HEAD'], { cwd: repo, windowsHide: true })
  ).stdout.trim();
  const auditRecord = {
    command,
    fullRelease: auditMode === 'release',
    sourceRevision,
    node: process.version,
    startedAt: new Date().toISOString(),
    credentialsPersisted: false,
    auditRoot: path.relative(repo, auditRoot),
  };
  report[auditMode === 'release' ? 'release' : 'aiBrowserDiagnostic'] =
    auditRecord;
  const scanService = await createApplicationLogScanService({
    scan: scanApplicationLogs,
  });
  exactSecrets.add(scanService.token);
  env.DOCMOST_AI_APPLICATION_LOG_SCAN_URL = scanService.url;
  env.DOCMOST_AI_APPLICATION_LOG_SCAN_TOKEN = scanService.token;
  try {
    const log = createWriteStream(path.join(output, 'verify-release.log'), {
      flags: 'wx',
    });
    const logFinished = finished(log);
    const child = spawn(
      process.platform === 'win32'
        ? (env.ComSpec ?? env.COMSPEC ?? 'cmd.exe')
        : 'corepack',
      process.platform === 'win32'
        ? ['/d', '/s', '/c', command]
        : ['pnpm', auditMode === 'release' ? 'verify:release' : 'test:ai:e2e'],
      { cwd: repo, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const relay = async (stream) => {
      for await (const line of createInterface({
        input: stream,
        crlfDelay: Infinity,
      })) {
        let safe = line;
        for (const secret of exactSecrets)
          safe = safe.replaceAll(secret, '[REDACTED]');
        safe = `${sanitizeLogText(safe)}\n`;
        if (!log.write(safe)) await once(log, 'drain');
        process.stdout.write(safe);
      }
    };
    const streams = Promise.all([relay(child.stdout), relay(child.stderr)]);
    let code;
    try {
      [code] = await once(child, 'exit');
    } finally {
      await streams;
      log.end();
      await logFinished;
      auditRecord.finishedAt = new Date().toISOString();
      auditRecord.exitCode = code ?? 1;
    }
    report.tests.push({
      name:
        auditMode === 'release'
          ? 'Full isolated verify:release'
          : 'Isolated AI browser diagnostic',
      passed: code === 0,
    });
    assert.equal(
      code,
      0,
      auditMode === 'release'
        ? 'Full isolated verify:release failed; inspect its sanitized log and audit receipts'
        : 'Isolated AI browser diagnostic failed; inspect its sanitized log and audit receipts',
    );
  } finally {
    await scanService.close();
    report.cleanup.applicationLogScanServiceClosed = true;
  }
}
