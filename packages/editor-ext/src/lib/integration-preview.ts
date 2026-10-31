import { Node, mergeAttributes } from '@tiptap/core';
import { parseIntegrationPreviewUrl } from './integration-preview-url';

export const IntegrationPreview = Node.create<{ view: any }>({
  name: 'integrationPreview',
  group: 'block',
  atom: true,
  draggable: true,
  addOptions() {
    return { view: null };
  },
  addAttributes() {
    return {
      url: {
        default: '',
        parseHTML: (element) =>
          parseIntegrationPreviewUrl(
            element.getAttribute('data-integration-url') ??
              element.getAttribute('href'),
          )?.url ?? '',
        renderHTML: (attrs) => ({
          'data-integration-url':
            parseIntegrationPreviewUrl(attrs.url)?.url ?? '',
        }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="integrationPreview"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    const target = parseIntegrationPreviewUrl(
      HTMLAttributes['data-integration-url'],
    );
    return [
      'div',
      mergeAttributes({ 'data-type': 'integrationPreview' }, HTMLAttributes),
      target
        ? [
            'a',
            { href: target.url, rel: 'noopener noreferrer', target: '_blank' },
            target.url,
          ]
        : '',
    ];
  },
  renderText({ node }) {
    return parseIntegrationPreviewUrl(node.attrs.url)?.url ?? '';
  },
  addNodeView() {
    return this.options.view;
  },
});

export const IntegrationMention = IntegrationPreview.extend({
  name: 'integrationMention',
  group: 'inline',
  inline: true,
  draggable: false,
  parseHTML() {
    return [{ tag: 'a[data-type="integrationMention"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    const target = parseIntegrationPreviewUrl(
      HTMLAttributes['data-integration-url'],
    );
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'integrationMention',
        href: target?.url ?? undefined,
        rel: 'noopener noreferrer',
        target: '_blank',
      }),
      target?.url ?? '',
    ];
  },
});
