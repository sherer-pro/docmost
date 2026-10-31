'use strict';
const path = require('node:path');
const { createRequire } = require('node:module');
const runtime = process.cwd();
if (
  !process.argv.includes('--synthetic-integration-previews') ||
  !runtime.includes(
    `${path.sep}artifacts${path.sep}database${path.sep}live${path.sep}`,
  )
)
  throw new Error('Integration fixture requires its isolated runtime');
const load = createRequire(path.join(runtime, 'dist/apps/server/src/main.js'));
load('reflect-metadata');
const { IntegrationPreviewHttpService } = load(
  path.join(
    runtime,
    'dist/apps/server/src/core/integration-preview/integration-preview-http.service.js',
  ),
);
// Transport is exercised separately against real HTTP sockets. This fixture owns
// only synthetic metadata and never contacts a provider or accepts real secrets.
IntegrationPreviewHttpService.prototype.read = async function (
  target,
  token,
  etag,
) {
  if (token && !token.startsWith('synthetic-preview-'))
    throw new Error('Non-synthetic credential rejected');
  if (token === 'synthetic-preview-denied')
    return { status: 403, data: null, etag: null };
  if (etag === '"synthetic-v1"') return { status: 304, data: null, etag: null };
  const title = token
    ? `Private ${target.provider} metadata`
    : 'Public GitHub metadata';
  return {
    status: 200,
    data:
      target.provider === 'figma'
        ? { file: { name: title } }
        : {
            title,
            full_name: title,
            name_with_namespace: title,
            state: 'open',
          },
    etag: '"synthetic-v1"',
  };
};
