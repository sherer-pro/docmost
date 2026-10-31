export interface IntegrationPreviewTarget {
  provider: 'github' | 'gitlab' | 'figma';
  kind: 'repository' | 'issue' | 'pullRequest' | 'commit' | 'file';
  url: string;
  apiPath: string;
}

const name = /^[A-Za-z0-9_.-]{1,100}$/;
const issueNumber = /^[1-9][0-9]{0,9}$/;
const commit = /^[a-f0-9]{7,64}$/i;

export function parseIntegrationPreviewUrl(
  value: unknown,
): IntegrationPreviewTarget | null {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    /[\p{Cc}\p{Cf}]/u.test(value)
  )
    return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    return null;
  let parts: string[];
  try {
    parts = url.pathname
      .replace(/\/$/, '')
      .split('/')
      .slice(1)
      .map(decodeURIComponent);
  } catch {
    return null;
  }
  const safeName = (part: string) =>
    name.test(part) && part !== '.' && part !== '..';
  const normalized = new URL(url.origin + url.pathname.replace(/\/$/, ''));
  if (/^#[A-Za-z0-9_.:-]{1,200}$/.test(url.hash)) normalized.hash = url.hash;
  if (
    url.hostname === 'github.com' &&
    parts.length >= 2 &&
    parts.slice(0, 2).every(safeName)
  ) {
    const root = `/repos/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`;
    if (parts.length === 2)
      return {
        provider: 'github',
        kind: 'repository',
        url: normalized.href,
        apiPath: root,
      };
    if (
      parts.length === 4 &&
      ['issues', 'pull'].includes(parts[2]) &&
      issueNumber.test(parts[3])
    )
      return {
        provider: 'github',
        kind: parts[2] === 'pull' ? 'pullRequest' : 'issue',
        url: normalized.href,
        apiPath: `${root}/${parts[2] === 'pull' ? 'pulls' : 'issues'}/${parts[3]}`,
      };
    if (parts.length === 4 && parts[2] === 'commit' && commit.test(parts[3]))
      return {
        provider: 'github',
        kind: 'commit',
        url: normalized.href,
        apiPath: `${root}/commits/${parts[3]}`,
      };
  }
  if (
    url.hostname === 'gitlab.com' &&
    parts.length >= 2 &&
    parts.length <= 24
  ) {
    const action = parts.indexOf('-');
    const project = action === -1 ? parts : parts.slice(0, action);
    if (project.length < 2 || !project.every(safeName)) return null;
    const root = `/api/v4/projects/${encodeURIComponent(project.join('/'))}`;
    if (action === -1)
      return {
        provider: 'gitlab',
        kind: 'repository',
        url: normalized.href,
        apiPath: root,
      };
    if (
      parts.length === action + 3 &&
      ['issues', 'merge_requests'].includes(parts[action + 1]) &&
      issueNumber.test(parts[action + 2])
    )
      return {
        provider: 'gitlab',
        kind: parts[action + 1] === 'issues' ? 'issue' : 'pullRequest',
        url: normalized.href,
        apiPath: `${root}/${parts[action + 1]}/${parts[action + 2]}`,
      };
    if (
      parts.length === action + 3 &&
      parts[action + 1] === 'commit' &&
      commit.test(parts[action + 2])
    )
      return {
        provider: 'gitlab',
        kind: 'commit',
        url: normalized.href,
        apiPath: `${root}/repository/commits/${parts[action + 2]}`,
      };
  }
  if (
    ['www.figma.com', 'figma.com'].includes(url.hostname) &&
    ['file', 'design', 'board', 'slides', 'proto', 'make'].includes(parts[0]) &&
    /^[A-Za-z0-9_-]{6,128}$/.test(parts[1] ?? '') &&
    parts.length <= 3
  ) {
    normalized.hostname = 'www.figma.com';
    const node = url.searchParams.get('node-id');
    if (node && /^[0-9]+[:-][0-9]+$/.test(node))
      normalized.searchParams.set('node-id', node);
    return {
      provider: 'figma',
      kind: 'file',
      url: normalized.href,
      apiPath: `/v1/files/${encodeURIComponent(parts[1])}/meta`,
    };
  }
  return null;
}
