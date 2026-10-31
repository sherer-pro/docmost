import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer as createTlsServer } from 'node:tls';
import { connect } from 'node:net';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../../..');
const load = createRequire(path.join(root, 'apps/server/package.json'));
const mode = process.argv[2];
if (mode === 'child') {
  const Redis = load('ioredis');
  const { parseRedisUrl } = load(
    path.join(root, 'apps/server/dist/apps/server/src/common/helpers/utils.js'),
  );
  const port = Number(process.argv[3]);
  const config = parseRedisUrl(
    `rediss://synthetic:p%40ss@localhost:${port}/2?family=4`,
  );
  const client = new Redis({
    ...config,
    lazyConnect: true,
    connectTimeout: 2000,
    retryStrategy: () => null,
    maxRetriesPerRequest: 0,
  });
  client.on('error', () => {});
  try {
    await client.connect();
    assert.equal(await client.acl('WHOAMI'), 'synthetic');
    assert.equal(await client.set('fixture-key', 'fixture-value'), 'OK');
    assert.equal(await client.get('fixture-key'), 'fixture-value');
    assert.equal(client.options.db, 2);
    const subscriber = client.duplicate({ lazyConnect: true });
    subscriber.on('error', () => {});
    try {
      await subscriber.connect();
      await subscriber.subscribe('fixture-channel');
      const message = once(subscriber, 'message');
      await client.publish('fixture-channel', 'fixture-message');
      assert.deepEqual(await message, ['fixture-channel', 'fixture-message']);
    } finally {
      subscriber.disconnect();
    }
    const { Queue, Worker, QueueEvents } = load('bullmq');
    const connection = { ...config, maxRetriesPerRequest: null };
    const queue = new Queue('tls-fixture', { connection });
    const events = new QueueEvents('tls-fixture', { connection });
    const worker = new Worker(
      'tls-fixture',
      async (job) => job.data.value * 2,
      { connection },
    );
    for (const item of [queue, events, worker]) item.on('error', () => {});
    try {
      await Promise.all([
        queue.waitUntilReady(),
        events.waitUntilReady(),
        worker.waitUntilReady(),
      ]);
      const job = await queue.add('calculate', { value: 21 });
      assert.equal(await job.waitUntilFinished(events, 10_000), 42);
    } finally {
      await Promise.allSettled([worker.close(), events.close(), queue.close()]);
    }
    await client.quit();
    const wrong = new Redis({
      ...config,
      tls: { ...config.tls, servername: 'wrong.example.test' },
      lazyConnect: true,
      connectTimeout: 2000,
      retryStrategy: () => null,
    });
    const errorCodes = [];
    wrong.on('error', (error) => errorCodes.push(error.code));
    try {
      await assert.rejects(wrong.connect());
      assert(errorCodes.includes('ERR_TLS_CERT_ALTNAME_INVALID'));
    } finally {
      wrong.disconnect();
    }
    console.log(
      'TLS, ACL, escaped password, database, pub/sub, BullMQ and hostname verification passed.',
    );
  } finally {
    client.disconnect();
  }
} else {
  const id = randomUUID().slice(0, 8);
  const name = `docmost-redis-tls-${id}`;
  const output = path.join(root, 'artifacts/redis-tls', id);
  await mkdir(output, { recursive: true });
  const key = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey;
  const certificateProgram = `import sys,datetime,ipaddress
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes,serialization
key=serialization.load_pem_private_key(sys.stdin.buffer.read(),password=None)
name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'localhost')])
now=datetime.datetime.now(datetime.timezone.utc)
cert=x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(minutes=1)).not_valid_after(now+datetime.timedelta(days=1)).add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'),x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]),critical=False).add_extension(x509.BasicConstraints(ca=True,path_length=None),critical=True).sign(key,hashes.SHA256())
sys.stdout.buffer.write(cert.public_bytes(serialization.Encoding.PEM))`;
  const certificateGenerator = spawn(
    process.env.DOCMOST_PYTHON ?? 'python',
    ['-c', certificateProgram],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
  );
  let cert = '';
  certificateGenerator.stdout.on('data', (part) => {
    cert += part;
  });
  certificateGenerator.stdin.end(key);
  assert.equal((await once(certificateGenerator, 'exit'))[0], 0);
  const ca = path.join(output, 'public-ca.pem');
  await writeFile(ca, cert);
  const sockets = new Set();
  let tls;
  let created = false;
  let protocolPassed = false;
  let containerRemoved = false;
  try {
    await exec(
      'docker',
      [
        'run',
        '-d',
        '--tmpfs',
        '/data:rw,nosuid,nodev,noexec',
        '--name',
        name,
        '--label',
        'docmost.synthetic=redis-tls',
        '-p',
        '127.0.0.1::6379',
        'redis:8-alpine',
        'redis-server',
        '--save',
        '',
        '--appendonly',
        'no',
      ],
      { windowsHide: true },
    );
    created = true;
    await exec(
      'docker',
      [
        'exec',
        name,
        'redis-cli',
        'ACL',
        'SETUSER',
        'synthetic',
        'on',
        '>p@ss',
        '~*',
        '&*',
        '+@all',
      ],
      { windowsHide: true },
    );
    const binding = await exec('docker', ['port', name, '6379/tcp'], {
      windowsHide: true,
    });
    const redisPort = Number(binding.stdout.trim().split(':').at(-1));
    tls = createTlsServer({ key, cert }, (socket) => {
      const target = connect(redisPort, '127.0.0.1');
      for (const item of [socket, target]) {
        sockets.add(item);
        item.on('error', () => {});
        item.on('close', () => sockets.delete(item));
      }
      socket.pipe(target).pipe(socket);
      socket.on('close', () => target.destroy());
      target.on('close', () => socket.destroy());
    });
    tls.on('tlsClientError', () => {});
    tls.listen(0, '127.0.0.1');
    await once(tls, 'listening');
    const result = await exec(
      process.execPath,
      [import.meta.filename, 'child', String(tls.address().port)],
      {
        windowsHide: true,
        timeout: 30_000,
        env: { ...process.env, NODE_EXTRA_CA_CERTS: ca },
      },
    );
    protocolPassed = true;
    console.log(result.stdout.trim());
  } finally {
    for (const socket of sockets) socket.destroy();
    if (tls?.listening) await new Promise((resolve) => tls.close(resolve));
    try {
      if (created) {
        await exec('docker', ['rm', '-fv', name], { windowsHide: true });
        containerRemoved = true;
      }
    } finally {
      await writeFile(path.join(output, 'result.json'), JSON.stringify({
        passed: protocolPassed && containerRemoved,
        protocolPassed, containerRemoved, mode: 'compiled-parser',
        privateKeyPersisted: false, checkedAt: new Date().toISOString(),
      }, null, 2));
    }
  }
}
