// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor, generateText } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { IntegrationPreview, IntegrationMention } from './integration-preview';
import { parseIntegrationPreviewUrl } from './integration-preview-url';
import { htmlToMarkdown } from './markdown/utils/turndown.utils';
import { SearchAndReplace } from './search-and-replace/search-and-replace';

describe('integration link contracts', () => {
  it('finds URLs as ordered whole nodes and leaves them intact during text replacement', () => {
    const url = 'https://github.com/private/project';
    const editor = new Editor({
      extensions: [
        StarterKit,
        IntegrationPreview,
        IntegrationMention,
        SearchAndReplace,
      ],
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'private text' },
              { type: 'integrationMention', attrs: { url } },
            ],
          },
          { type: 'integrationPreview', attrs: { url } },
        ],
      },
    });
    editor.commands.setSearchTerm('private');
    expect(
      editor.storage.searchAndReplace.results.map((match) =>
        Boolean(match.readOnly),
      ),
    ).toEqual([false, true, true]);
    editor.commands.setReplaceTerm('public');
    editor.commands.replaceAll();
    expect(editor.getText()).toContain('public text');
    expect(editor.storage.searchAndReplace.results).toHaveLength(2);
    editor.commands.replace();
    expect(editor.getJSON().content?.[1]).toMatchObject({
      type: 'integrationPreview',
      attrs: { url },
    });
    expect(editor.getHTML()).toContain(url);
    editor.destroy();
  });
  it.each([
    ['https://github.com/docmost/docmost', 'github', '/repos/docmost/docmost'],
    [
      'https://github.com/a/b/issues/12#issuecomment-20',
      'github',
      '/repos/a/b/issues/12',
    ],
    ['https://github.com/a/b/pull/3', 'github', '/repos/a/b/pulls/3'],
    [
      'https://github.com/a/b/commit/abc1234',
      'github',
      '/repos/a/b/commits/abc1234',
    ],
    [
      'https://gitlab.com/group/sub/project/-/issues/20',
      'gitlab',
      '/api/v4/projects/group%2Fsub%2Fproject/issues/20',
    ],
    [
      'https://gitlab.com/group/project/-/merge_requests/4',
      'gitlab',
      '/api/v4/projects/group%2Fproject/merge_requests/4',
    ],
    [
      'https://gitlab.com/group/project/-/commit/abc1234',
      'gitlab',
      '/api/v4/projects/group%2Fproject/repository/commits/abc1234',
    ],
    [
      'https://www.figma.com/design/AbCd123456/Design?node-id=12-3',
      'figma',
      '/v1/files/AbCd123456/meta',
    ],
  ])(
    'maps a bounded provider URL %s to one read-only endpoint',
    (url, provider, apiPath) => {
      expect(parseIntegrationPreviewUrl(url)).toMatchObject({
        provider,
        apiPath,
      });
    },
  );
  it.each([
    'http://github.com/a/b',
    'https://github.com.evil.example/a/b',
    'https://user:credential@github.com/a/b',
    'https://github.com:444/a/b',
    'https://127.0.0.1/a/b',
    'https://github.com/a/b/actions',
    'https://gitlab.com/group/project/-/issues/1/notes',
    'https://github.com/a%2fb/c',
    'https://www.figma.com/design/%2fetc%2fpasswd/Design',
  ])('rejects unsupported targets and endpoint injection %s', (url) => {
    expect(parseIntegrationPreviewUrl(url)).toBeNull();
  });
  it('does not retain credential or tracking query parameters', () => {
    expect(
      parseIntegrationPreviewUrl(
        'https://github.com/a/b?access_token=synthetic#issue-2',
      )?.url,
    ).toBe('https://github.com/a/b#issue-2');
    expect(
      parseIntegrationPreviewUrl(
        'https://figma.com/design/AbCd123456/Design?node-id=1-2&token=synthetic',
      )?.url,
    ).toBe('https://www.figma.com/design/AbCd123456/Design?node-id=1-2');
  });
  it('keeps only URLs through HTML, Markdown, text, copy and undo rather than persisting private metadata', () => {
    const extensions = [StarterKit, IntegrationPreview, IntegrationMention];
    const url = 'https://github.com/private/project/issues/2';
    const editor = new Editor({
      extensions,
      content: {
        type: 'doc',
        content: [
          {
            type: 'integrationPreview',
            attrs: {
              url,
              title: 'PRIVATE_TITLE',
              description: 'PRIVATE_DESCRIPTION',
              connectionId: 'FOREIGN_CONNECTION',
            },
          },
          {
            type: 'paragraph',
            content: [
              {
                type: 'integrationMention',
                attrs: { url, title: 'PRIVATE_TITLE' },
              },
            ],
          },
        ],
      },
    });
    const html = editor.getHTML();
    expect(JSON.stringify(editor.getJSON())).not.toMatch(
      /PRIVATE_TITLE|PRIVATE_DESCRIPTION|FOREIGN_CONNECTION/,
    );
    expect(html).not.toMatch(
      /PRIVATE_TITLE|PRIVATE_DESCRIPTION|FOREIGN_CONNECTION/,
    );
    expect(generateText(editor.getJSON(), extensions)).toContain(url);
    expect(htmlToMarkdown(html)).toContain(url);
    const copied = new Editor({ extensions, content: html });
    expect(copied.getJSON().content?.[0].attrs).toEqual({ url });
    editor.commands.insertContent({
      type: 'integrationPreview',
      attrs: { url: 'https://github.com/public/project' },
    });
    expect(editor.getHTML()).toContain('https://github.com/public/project');
    editor.commands.undo();
    expect(editor.getHTML()).not.toContain('https://github.com/public/project');
    editor.commands.redo();
    expect(editor.getHTML()).toContain('https://github.com/public/project');
    copied.destroy();
    editor.destroy();
  });
});
