import { Node } from '@tiptap/pm/model';

export function updateAttachmentAttr(
  node: Node,
  attr: 'src' | 'url',
  token?: string,
) {
  const attrVal = node.attrs[attr];
  if (
    attrVal &&
    (attrVal.startsWith('/files') ||
      attrVal.startsWith('/api/files') ||
      attrVal.startsWith('/attachments/files') ||
      attrVal.startsWith('/api/attachments/files'))
  ) {
    // @ts-ignore
    node.attrs[attr] = updateAttachmentUrl(attrVal, token);
  }
}

function updateAttachmentUrl(src: string, jwtToken?: string) {
  let updatedSrc = src;

  if (updatedSrc.includes('/attachments/files/')) {
    updatedSrc = updatedSrc.replace(
      '/attachments/files/',
      '/attachments/files/public/',
    );
  } else {
    updatedSrc = updatedSrc.replace('/files/', '/files/public/');
  }

  let parsed: URL;
  try {
    parsed = new URL(updatedSrc, 'https://docmost.local');
  } catch {
    return updatedSrc;
  }

  // Strip legacy query tokens from persisted content by default.
  parsed.searchParams.delete('jwt');

  if (jwtToken) {
    parsed.searchParams.set('jwt', jwtToken);
  }

  const search = parsed.searchParams.toString();
  return `${parsed.pathname}${search ? `?${search}` : ''}${parsed.hash}`;
}
