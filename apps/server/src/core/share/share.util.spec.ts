import { updateAttachmentAttr } from './share.util';

describe('updateAttachmentAttr', () => {
  it('rewrites legacy /files URLs to /files/public without query token by default', () => {
    const node = {
      attrs: {
        src: '/api/files/abc/file.png',
      },
    } as any;

    updateAttachmentAttr(node, 'src');

    expect(node.attrs.src).toBe('/api/files/public/abc/file.png');
  });

  it('rewrites canonical /attachments/files URLs to /attachments/files/public without query token by default', () => {
    const node = {
      attrs: {
        src: '/api/attachments/files/abc/file.png',
      },
    } as any;

    updateAttachmentAttr(node, 'src');

    expect(node.attrs.src).toBe(
      '/api/attachments/files/public/abc/file.png',
    );
  });

  it('still supports explicit token append for backward compatibility', () => {
    const node = {
      attrs: {
        src: '/api/files/abc/file.png',
      },
    } as any;

    updateAttachmentAttr(node, 'src', 'token-1');

    expect(node.attrs.src).toBe('/api/files/public/abc/file.png?jwt=token-1');
  });

  it('appends token to URLs that already have query params', () => {
    const node = {
      attrs: {
        src: '/api/files/abc/file.png?t=1',
      },
    } as any;

    updateAttachmentAttr(node, 'src', 'token-3');

    expect(node.attrs.src).toBe('/api/files/public/abc/file.png?t=1&jwt=token-3');
  });

  it('removes stale legacy jwt query when no explicit token is provided', () => {
    const node = {
      attrs: {
        src: '/api/files/abc/file.png?jwt=expired&t=1',
      },
    } as any;

    updateAttachmentAttr(node, 'src');

    expect(node.attrs.src).toBe('/api/files/public/abc/file.png?t=1');
  });

  it('replaces existing jwt query token when explicit token is provided', () => {
    const node = {
      attrs: {
        src: '/api/files/abc/file.png?jwt=old&t=1',
      },
    } as any;

    updateAttachmentAttr(node, 'src', 'token-new');

    expect(node.attrs.src).toBe('/api/files/public/abc/file.png?t=1&jwt=token-new');
  });
});
