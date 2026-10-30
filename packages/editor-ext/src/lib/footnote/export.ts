import { footnoteNodeText } from './footnote';

export const escapeFootnoteHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Numbers a copy, leaving persisted content and collaborative state untouched. */
export function prepareFootnotesForExport<T>(
  document: T,
  scope = '',
): { content: T; footerHtml: string } {
  const prefix = /^[A-Za-z0-9_-]{1,128}$/.test(scope) ? `${scope}-` : '';
  const notes: string[] = [];
  const copy = (node: any): any => {
    if (!node || typeof node !== 'object') return node;
    const result = { ...node };
    if (node.attrs) result.attrs = { ...node.attrs };
    if (node.type === 'footnote') {
      notes.push(footnoteNodeText(node));
      result.attrs = {
        ...node.attrs,
        number: notes.length,
        exportPrefix: prefix ? scope : '',
      };
    }
    if (Array.isArray(node.content)) result.content = node.content.map(copy);
    return result;
  };
  const content = copy(document);
  const footerHtml = notes.length
    ? `<section data-footnotes="true" role="doc-endnotes"><hr><ol>${notes.map((text, index) => `<li id="${prefix}fn-${index + 1}">${escapeFootnoteHtml(text).replace(/\n/g, '<br>')} <a href="#${prefix}fnref-${index + 1}" role="doc-backlink">[${index + 1}]</a></li>`).join('')}</ol></section>`
    : '';
  return { content, footerHtml };
}
