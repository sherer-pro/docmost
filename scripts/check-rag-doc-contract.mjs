import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const inventoryPath = path.join(
  root,
  'apps/server/docs/api-route-inventory.generated.md',
);
const collectionPath = path.join(
  root,
  'docs/Docmost RAG API.postman_collection.json',
);

const [inventoryText, collectionText] = await Promise.all([
  readFile(inventoryPath, 'utf8'),
  readFile(collectionPath, 'utf8'),
]);
const collection = JSON.parse(collectionText);

if (!collection.info?.description?.includes('opaque cursor v2')) {
  throw new Error('Postman collection does not document opaque cursor v2');
}

const inventoryRoutes = new Set(
  inventoryText
    .split(/\r?\n/)
    .map((line) =>
      /^\| (GET) \| `([^`]+)` \| `apps\/server\/src\/core\/rag\/rag\.controller\.ts` \|$/.exec(
        line,
      ),
    )
    .filter(Boolean)
    .map((match) => `${match[1]} ${match[2]}`),
);
if (inventoryRoutes.size === 0) {
  throw new Error('Generated route inventory contains no RAG GET routes');
}

const requests = [];
const visit = (items = []) => {
  for (const item of items) {
    if (item.request) requests.push(item);
    visit(item.item);
  }
};
visit(collection.item);

const postmanRoutes = new Set(
  requests
    .filter((item) => item.request?.url?.path?.[0] === 'rag')
    .map((item) => {
      const route = item.request.url.path
        .map((segment) =>
          String(segment).replace(/^\{\{(.+)\}\}$/, ':$1'),
        )
        .join('/');
      if (item.request.auth?.type !== 'bearer') {
        throw new Error(`RAG request lacks bearer auth: ${item.name}`);
      }
      return `${item.request.method} /${route}`;
    }),
);

const missing = [...inventoryRoutes].filter((route) => !postmanRoutes.has(route));
const extra = [...postmanRoutes].filter((route) => !inventoryRoutes.has(route));
if (missing.length > 0 || extra.length > 0) {
  throw new Error(
    [
      missing.length ? `Missing Postman routes: ${missing.join(', ')}` : '',
      extra.length ? `Unknown Postman routes: ${extra.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

for (const expectedPath of ['api-keys', 'api-keys/create']) {
  const item = requests.find(
    (candidate) => candidate.request?.url?.path?.join('/') === expectedPath,
  );
  if (!item) throw new Error(`Missing API-key example: ${expectedPath}`);
  const body = JSON.parse(item.request.body?.raw ?? '{}');
  if (body.keyType !== 'rag') {
    throw new Error(`API-key example must use keyType=rag: ${item.name}`);
  }
  if ('adminView' in body) {
    throw new Error(`API-key example uses retired adminView: ${item.name}`);
  }
}

const cursorFeeds = [
  'rag/updates',
  'rag/deleted',
  'rag/attachments/updates',
  'rag/attachments/deleted',
];
for (const expectedPath of cursorFeeds) {
  const item = requests.find(
    (candidate) => candidate.request?.url?.path?.join('/') === expectedPath,
  );
  if (!item?.request?.description?.includes('hasMore=false')) {
    throw new Error(`Cursor feed omits terminal watermark semantics: ${expectedPath}`);
  }
  const script = (item.event ?? [])
    .flatMap((event) => event.script?.exec ?? [])
    .join('\n');
  if (!script.includes('hasMore === false')) {
    throw new Error(`Cursor feed advances its watermark before terminal page: ${expectedPath}`);
  }
}

console.log(
  `RAG documentation contract is current: ${inventoryRoutes.size} routes`,
);
