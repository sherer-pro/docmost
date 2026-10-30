import * as _TurndownService from '@joplin/turndown';
import * as TurndownPluginGfm from '@joplin/turndown-plugin-gfm';
import { getTagLabel, getValidTagValue } from '../../tag';
import {
  formatTransclusionMarkdown,
  TRANSCLUSION_CONTENT_ATTRIBUTE,
  TransclusionPresentationStrings,
} from '../../transclusion/transclusion-presentation';
import { getBasename } from './basename';
import { footnoteText } from '../../footnote';
import { escapeFootnoteMarkdown } from '../../footnote/markdown';

// CJS/ESM interop: .default exists in Vite, not in NestJS
const TurndownService = (_TurndownService as any).default || _TurndownService;

export interface HtmlToMarkdownOptions {
  transclusion?: TransclusionPresentationStrings;
}

export function htmlToMarkdown(
  html: string,
  options: HtmlToMarkdownOptions = {},
): string {
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    hr: '---',
    bulletListMarker: '-',
  });

  turndownService.use([
    TurndownPluginGfm.tables,
    TurndownPluginGfm.strikethrough,
    TurndownPluginGfm.highlightedCodeBlock,
    taskList,
    tag,
    callout,
    preserveDetail,
    listParagraph,
    mathInline,
    mathBlock,
    iframeEmbed,
    video,
    (service) => transclusion(service, options.transclusion),
  ]);
  const notes = new Map<string, { number: number; text: string }>();
  turndownService.addRule('footnote', {
    filter: (node: HTMLElement) =>
      node.nodeName === 'SUP' && node.getAttribute('data-type') === 'footnote',
    replacement: (_content: string, node: HTMLElement) => {
      const text = footnoteText(node.getAttribute('data-footnote-text'));
      const id =
        node.querySelector('a[id]')?.getAttribute('id') ||
        node.getAttribute('data-footnote-id') ||
        '';
      const key = `${id}\u0000${text}`;
      let note = notes.get(key);
      if (!note) {
        note = { number: notes.size + 1, text };
        notes.set(key, note);
      }
      return `[^${note.number}]`;
    },
  });
  turndownService.addRule('footnoteFooter', {
    filter: (node: HTMLElement) => node.hasAttribute('data-footnotes'),
    replacement: () => '',
  });
  const body = turndownService.turndown(html).replaceAll('<br>', ' ');
  return notes.size
    ? `${body}\n\n${[...notes.values()].map((note) => `[^${note.number}]: ${escapeFootnoteMarkdown(note.text)}`).join('\n\n')}`
    : body;
}

function transclusion(
  turndownService: _TurndownService,
  strings?: TransclusionPresentationStrings,
) {
  turndownService.addRule('transclusion', {
    filter: function (node: HTMLInputElement) {
      const type = node.getAttribute('data-type');
      return (
        node.nodeName === 'DIV' &&
        (type === 'transclusionSource' || type === 'transclusionReference')
      );
    },
    replacement: function (_content: string, node: HTMLInputElement) {
      const contentElement = node.querySelector(
        `[${TRANSCLUSION_CONTENT_ATTRIBUTE}]`,
      );
      const markdown = contentElement
        ? turndownService.turndown(contentElement.innerHTML)
        : '';

      return formatTransclusionMarkdown(
        markdown,
        strings ?? {
          label: 'Synced block',
          unavailable: 'Content unavailable',
        },
      );
    },
  });
}

function listParagraph(turndownService: _TurndownService) {
  turndownService.addRule('paragraph', {
    filter: ['p'],
    replacement: (content: string, node: HTMLInputElement) => {
      if (node.parentElement?.nodeName === 'LI') {
        return content;
      }
      return `\n\n${content}\n\n`;
    },
  });
}

function callout(turndownService: _TurndownService) {
  turndownService.addRule('callout', {
    filter: function (node: HTMLInputElement) {
      return (
        node.nodeName === 'DIV' && node.getAttribute('data-type') === 'callout'
      );
    },
    replacement: function (content: string, node: HTMLInputElement) {
      const calloutType = node.getAttribute('data-callout-type');
      return `\n\n:::${calloutType}\n${content.trim()}\n:::\n\n`;
    },
  });
}

function tag(turndownService: _TurndownService) {
  turndownService.addRule('tag', {
    filter: function (node: HTMLInputElement) {
      return (
        node.nodeName === 'SPAN' && node.getAttribute('data-type') === 'tag'
      );
    },
    replacement: function (_content: string, node: HTMLInputElement) {
      const value = getValidTagValue(
        node.getAttribute('data-tag-value') || node.textContent,
      );

      return `::tag[${getTagLabel(value)}]`;
    },
  });
}

function taskList(turndownService: _TurndownService) {
  turndownService.addRule('taskListItem', {
    filter: function (node: HTMLInputElement) {
      return (
        node.getAttribute('data-type') === 'taskItem' &&
        node.parentNode.nodeName === 'UL'
      );
    },
    replacement: function (content: string, node: HTMLInputElement) {
      const checkbox = node.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      const isChecked = checkbox.checked;

      // Process content like regular list items
      content = content
        .replace(/^\n+/, '') // remove leading newlines
        .replace(/\n+$/, '\n') // replace trailing newlines with just a single one
        .replace(/\n/gm, '\n  '); // indent nested content with 2 spaces

      // Create the checkbox prefix
      const prefix = `- ${isChecked ? '[x]' : '[ ]'} `;

      return (
        prefix +
        content +
        (node.nextSibling && !/\n$/.test(content) ? '\n' : '')
      );
    },
  });
}

function preserveDetail(turndownService: _TurndownService) {
  turndownService.addRule('preserveDetail', {
    filter: function (node: HTMLInputElement) {
      return node.nodeName === 'DETAILS';
    },
    replacement: function (_content: string, node: HTMLInputElement) {
      const summary = node.querySelector(':scope > summary');
      let detailSummary = '';

      if (summary) {
        detailSummary = `<summary>${turndownService.turndown(summary.innerHTML)}</summary>`;
      }

      const detailsContent = Array.from(node.childNodes)
        .filter((child) => child.nodeName !== 'SUMMARY')
        .map((child) =>
          child.nodeType === 1
            ? turndownService.turndown((child as HTMLElement).outerHTML)
            : child.textContent,
        )
        .join('');

      return `\n<details>\n${detailSummary}\n\n${detailsContent}\n\n</details>\n`;
    },
  });
}

function mathInline(turndownService: _TurndownService) {
  turndownService.addRule('mathInline', {
    filter: function (node: HTMLInputElement) {
      return (
        node.nodeName === 'SPAN' &&
        node.getAttribute('data-type') === 'mathInline'
      );
    },
    replacement: function (content: string) {
      return `$${content}$`;
    },
  });
}

function mathBlock(turndownService: _TurndownService) {
  turndownService.addRule('mathBlock', {
    filter: function (node: HTMLInputElement) {
      return (
        node.nodeName === 'DIV' &&
        node.getAttribute('data-type') === 'mathBlock'
      );
    },
    replacement: function (content: string) {
      return `\n$$\n${content}\n$$\n`;
    },
  });
}

function iframeEmbed(turndownService: _TurndownService) {
  turndownService.addRule('iframeEmbed', {
    filter: function (node: HTMLInputElement) {
      return node.nodeName === 'IFRAME';
    },
    replacement: function (_content: string, node: HTMLInputElement) {
      const src = node.getAttribute('src');
      return '[' + src + '](' + src + ')';
    },
  });
}

function video(turndownService: _TurndownService) {
  turndownService.addRule('video', {
    filter: function (node: HTMLInputElement) {
      return node.tagName === 'VIDEO';
    },
    replacement: function (_content: string, node: HTMLInputElement) {
      const src = node.getAttribute('src') || '';
      const name = getBasename(src) || src;
      return '[' + name + '](' + src + ')';
    },
  });
}
