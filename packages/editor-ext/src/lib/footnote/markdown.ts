import type { MarkedExtension } from 'marked';
import { generateNodeId } from '../utils';
import { footnoteText } from './footnote';
import { escapeFootnoteHtml } from './export';

/** One parser owns its definitions; concurrent documents never share a map. */
export function footnoteMarkdownExtension(): MarkedExtension {
  const definitions = new Map<string, string>();
  let number = 0;
  return {
    extensions: [
      {
        name: 'footnoteDefinition',
        level: 'block',
        start(source: string) {
          const index = source.search(/\[\^[^\]\s]{1,100}\]:/);
          return index < 0 ? undefined : index;
        },
        tokenizer(source: string) {
          const match =
            /^\[\^([^\]\s]{1,100})\]:[ \t]*[^\n]*(?:\n(?: {4}|\t)[^\n]*)*\n?/.exec(
              source,
            );
          if (!match) return;
          const text = match[0]
            .replace(/^\[\^[^\]]+\]:[ \t]*/, '')
            .replace(/\n(?: {4}|\t)/g, '\n')
            .trimEnd()
            .replace(/\\([\\`*{}\[\]()#+.!_<>~\-])/g, '$1');
          definitions.set(match[1], footnoteText(text));
          return { type: 'footnoteDefinition', raw: match[0] };
        },
        renderer() {
          return '';
        },
      },
      {
        name: 'footnoteReference',
        level: 'inline',
        start(source: string) {
          const index = source.indexOf('[^');
          return index < 0 ? undefined : index;
        },
        tokenizer(source: string) {
          const match = /^\[\^([^\]\s]{1,100})\]/.exec(source);
          if (match)
            return { type: 'footnoteReference', raw: match[0], key: match[1] };
        },
        renderer(token: any) {
          const text = definitions.get(token.key);
          if (text === undefined) return escapeFootnoteHtml(token.raw);
          number++;
          return `<sup data-type="footnote" data-footnote-id="${generateNodeId()}" data-footnote-text="${escapeFootnoteHtml(text)}"><a href="#fn-${number}">${number}</a></sup>`;
        },
      },
    ],
  };
}

export function escapeFootnoteMarkdown(text: string): string {
  return footnoteText(text)
    .replace(/[\\`*{}\[\]()#+.!_<>~\-]/g, '\\$&')
    .replace(/\n/g, '\n    ');
}
