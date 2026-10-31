import { BadRequestException } from '@nestjs/common';
import * as cheerio from 'cheerio';
import * as JSZip from 'jszip';
import { createHash } from 'node:crypto';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const BODY_WIDTH = 9638;
const MAX_HTML_BYTES = 16 * 1024 * 1024;
const MAX_MEDIA_BYTES = 64 * 1024 * 1024;
const xml = (value: unknown) => {
  let clean = '';
  for (const character of String(value ?? '')) {
    const code = character.codePointAt(0)!;
    if (
      [9, 10, 13].includes(code) ||
      (code >= 32 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      code >= 0x10000
    )
      clean += character;
  }
  return clean
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};
const part = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`;
const run = (text: string, properties = '') =>
  `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
const bookmark = (id: string) =>
  `b${createHash('sha256').update(id).digest('hex').slice(0, 24)}`;

type InlineStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  sup?: boolean;
  sub?: boolean;
  rtl?: boolean;
};
type ParagraphOptions = {
  style?: string;
  numId?: number;
  level?: number;
  width?: number;
  rtl?: boolean;
};

/** Creates ordinary OOXML only: no macros, altChunk, remote media or execution. */
export async function renderDocx(params: {
  html: string;
  title: string;
  appUrl: string;
}): Promise<Buffer> {
  if (Buffer.byteLength(params.html, 'utf8') > MAX_HTML_BYTES)
    throw new BadRequestException('DOCX document exceeds the export limit');
  const $ = cheerio.load(params.html, null, false);
  $('script,style,iframe,object,embed,button').remove();
  if ($('*').length > 100000)
    throw new BadRequestException('DOCX document contains too many elements');
  const zip = new JSZip();
  const relationships: string[] = [];
  const types = new Set<string>();
  const footnotes: string[] = [];
  const footnoteIds = new Map<string, number>();
  const numbering: string[] = [];
  let mediaBytes = 0;
  let imageId = 0;
  let bookmarkId = 0;
  const relation = (type: string, target: string, external = false) => {
    const id = `rId${relationships.length + 1}`;
    relationships.push(
      `<Relationship Id="${id}" Type="${R}/${type}" Target="${xml(target)}"${external ? ' TargetMode="External"' : ''}/>`,
    );
    return id;
  };
  const hyperlink = (value: string): string | null => {
    if (!value.trim()) return null;
    try {
      const url = new URL(value, params.appUrl);
      if (
        !['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return null;
      return url.toString();
    } catch {
      return null;
    }
  };
  const styleProperties = (style: InlineStyle) =>
    [
      style.bold ? '<w:b/>' : '',
      style.italic ? '<w:i/>' : '',
      style.underline ? '<w:u w:val="single"/>' : '',
      style.strike ? '<w:strike/>' : '',
      style.code
        ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:fill="F2F2F2"/>'
        : '',
      style.sup || style.sub
        ? `<w:vertAlign w:val="${style.sup ? 'superscript' : 'subscript'}"/>`
        : '',
      style.rtl ? '<w:rtl/>' : '',
    ].join('');
  const image = (node: any, width: number) => {
    const source = $(node).attr('src') ?? '';
    const match = /^data:image\/(png|jpeg|gif);base64,([A-Za-z0-9+/=]+)$/u.exec(
      source,
    );
    const fallback = () => run($(node).attr('alt') || '[Image unavailable]');
    if (!match) return fallback();
    const buffer = Buffer.from(match[2], 'base64');
    let dimensions: [number, number] | null = null;
    if (
      match[1] === 'png' &&
      buffer.length >= 24 &&
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      dimensions = [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
    if (
      match[1] === 'gif' &&
      buffer.length >= 10 &&
      /^GIF8[79]a$/u.test(buffer.subarray(0, 6).toString('ascii'))
    )
      dimensions = [buffer.readUInt16LE(6), buffer.readUInt16LE(8)];
    if (match[1] === 'jpeg' && buffer[0] === 255 && buffer[1] === 216) {
      let offset = 2;
      while (offset + 4 <= buffer.length) {
        if (buffer[offset++] !== 255) break;
        while (buffer[offset] === 255) offset++;
        const marker = buffer[offset++];
        if (offset + 2 > buffer.length) break;
        if (marker === 217 || marker === 218) break;
        if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
        const length = buffer.readUInt16BE(offset);
        if (length < 2 || offset + length > buffer.length) break;
        if (
          [
            192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
          ].includes(marker) &&
          length >= 7
        ) {
          dimensions = [
            buffer.readUInt16BE(offset + 5),
            buffer.readUInt16BE(offset + 3),
          ];
          break;
        }
        offset += length;
      }
    }
    if (
      !dimensions ||
      dimensions.some((value) => !value) ||
      dimensions[0] * dimensions[1] > 40000000
    )
      return fallback();
    mediaBytes += buffer.length;
    if (++imageId > 100 || mediaBytes > MAX_MEDIA_BYTES)
      throw new BadRequestException('DOCX images exceed the export limit');
    const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
    types.add(extension);
    zip.file(`word/media/image${imageId}.${extension}`, buffer);
    const id = relation('image', `media/image${imageId}.${extension}`);
    const maxWidth = width / 15;
    const scale = Math.min(1, maxWidth / dimensions[0], 850 / dimensions[1]);
    const cx = Math.round(dimensions[0] * scale * 9525),
      cy = Math.round(dimensions[1] * scale * 9525);
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${imageId}" name="Image ${imageId}" descr="${xml($(node).attr('alt') ?? '')}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${imageId}" name="image${imageId}.${extension}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  };
  const inline = (
    node: any,
    style: InlineStyle = {},
    width = BODY_WIDTH,
    depth = 0,
  ): string => {
    if (depth > 64)
      throw new BadRequestException(
        'DOCX document nesting exceeds the export limit',
      );
    if (node.type === 'text')
      return node.data
        .split('\n')
        .map((text: string) => run(text, styleProperties(style)))
        .join('<w:r><w:br/></w:r>');
    if (node.type !== 'tag') return '';
    const tag = node.name;
    if (tag === 'img') return image(node, width);
    if (tag === 'br') return '<w:r><w:br/></w:r>';
    if (tag === 'sup' && $(node).attr('data-type') === 'footnote') {
      const href = $(node).find('a').attr('href')?.slice(1);
      const id = href ? footnoteIds.get(href) : null;
      return id
        ? `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`
        : '';
    }
    if (tag === 'a' && $(node).attr('role') === 'doc-backlink') return '';
    const next = {
      ...style,
      ...(['b', 'strong'].includes(tag) ? { bold: true } : {}),
      ...(['i', 'em'].includes(tag) ? { italic: true } : {}),
      ...(tag === 'u' ? { underline: true } : {}),
      ...(['s', 'del', 'strike'].includes(tag) ? { strike: true } : {}),
      ...(tag === 'code' ? { code: true } : {}),
      ...(tag === 'sup' ? { sup: true } : {}),
      ...(tag === 'sub' ? { sub: true } : {}),
      ...($(node).attr('dir') === 'rtl' ? { rtl: true } : {}),
    };
    const contents = (node.children ?? [])
      .map((child: any) => inline(child, next, width, depth + 1))
      .join('');
    if (tag !== 'a') return contents;
    const href = $(node).attr('href') ?? '';
    if (/^#[^\s]+$/u.test(href))
      return `<w:hyperlink w:anchor="${bookmark(href.slice(1))}">${contents}</w:hyperlink>`;
    const target = hyperlink(href);
    return target
      ? `<w:hyperlink r:id="${relation('hyperlink', target, true)}">${contents}</w:hyperlink>`
      : contents;
  };
  const paragraph = (node: any, options: ParagraphOptions = {}) => {
    const direction = node.attribs?.dir;
    const align = /text-align:\s*(center|right|justify)/u.exec(
      node.attribs?.style ?? '',
    )?.[1];
    const id = node.attribs?.id;
    const markId = ++bookmarkId;
    const props = `${options.style ? `<w:pStyle w:val="${xml(options.style)}"/>` : ''}${options.numId ? `<w:numPr><w:ilvl w:val="${Math.min(options.level ?? 0, 8)}"/><w:numId w:val="${options.numId}"/></w:numPr>` : ''}${direction === 'rtl' || options.rtl ? '<w:bidi/>' : ''}${align ? `<w:jc w:val="${align}"/>` : ''}`;
    return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${id ? `<w:bookmarkStart w:id="${markId}" w:name="${bookmark(id)}"/>` : ''}${(node.children ?? [node]).map((child: any) => inline(child, { rtl: direction === 'rtl' }, options.width ?? BODY_WIDTH)).join('')}${id ? `<w:bookmarkEnd w:id="${markId}"/>` : ''}</w:p>`;
  };
  $('[data-footnotes] li[id]').each((index, node) => {
    const id = index + 1;
    footnoteIds.set($(node).attr('id')!, id);
    footnotes.push(
      `<w:footnote w:id="${id}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>${run(' ')}${(node.children ?? []).map((child) => inline(child)).join('')}</w:p></w:footnote>`,
    );
  });
  $('[data-footnotes]').remove();
  const blocks = (
    nodes: any[],
    options: ParagraphOptions = {},
    depth = 0,
  ): string => {
    if (depth > 64)
      throw new BadRequestException(
        'DOCX document nesting exceeds the export limit',
      );
    let output = '';
    let pending: any[] = [];
    const flush = () => {
      if (pending.length) {
        output += paragraph({ children: pending }, options);
        pending = [];
      }
    };
    for (const node of nodes) {
      if (node.type === 'text' && !node.data.trim() && pending.length === 0)
        continue;
      const tag = node.name;
      if (
        ![
          'p',
          'h1',
          'h2',
          'h3',
          'h4',
          'h5',
          'h6',
          'ul',
          'ol',
          'li',
          'table',
          'div',
          'section',
          'article',
          'aside',
          'blockquote',
          'pre',
          'hr',
          'details',
          'summary',
          'figure',
          'figcaption',
        ].includes(tag)
      ) {
        pending.push(node);
        continue;
      }
      flush();
      if (/^h[1-6]$/u.test(tag))
        output += paragraph(node, {
          ...options,
          style: tag === 'h1' && !output ? 'Title' : `Heading${tag[1]}`,
        });
      else if (tag === 'p' || tag === 'summary' || tag === 'figcaption')
        output += paragraph(node, options);
      else if (tag === 'pre')
        output += paragraph(node, { ...options, style: 'Code' });
      else if (tag === 'hr')
        output +=
          '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:color="D9D9D9"/></w:pBdr></w:pPr></w:p>';
      else if ($(node).attr('data-type') === 'pageBreak')
        output += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      else if (tag === 'ul' || tag === 'ol') {
        const numId = numbering.length + 1;
        const start = Math.min(
          1000000,
          Math.max(1, Number($(node).attr('start')) || 1),
        );
        numbering.push(
          `<w:num w:numId="${numId}"><w:abstractNumId w:val="${tag === 'ol' ? 1 : 0}"/>${tag === 'ol' ? `<w:lvlOverride w:ilvl="${Math.min(options.level ?? 0, 8)}"><w:startOverride w:val="${start}"/></w:lvlOverride>` : ''}</w:num>`,
        );
        for (const item of $(node).children('li').toArray()) {
          const children = item.children ?? [];
          const nonLists = children.filter(
            (child: any) => !['ul', 'ol'].includes(child.name),
          );
          const first = nonLists.find((child: any) => child.name === 'p');
          output += first
            ? paragraph(first, { ...options, numId }) +
              blocks(
                nonLists.filter((child: any) => child !== first),
                options,
                depth + 1,
              )
            : paragraph({ children: nonLists }, { ...options, numId });
          output += blocks(
            children.filter((child: any) => ['ul', 'ol'].includes(child.name)),
            { ...options, level: Math.min((options.level ?? 0) + 1, 8) },
            depth + 1,
          );
        }
      } else if (tag === 'table') {
        const rows = $(node)
          .find('tr')
          .filter((_, row) => $(row).closest('table')[0] === node)
          .toArray();
        if (rows.length > 10000)
          throw new BadRequestException('DOCX table contains too many rows');
        const columns = Math.max(
          1,
          ...rows.map((row) =>
            $(row)
              .children('th,td')
              .toArray()
              .reduce(
                (sum, cell) =>
                  sum +
                  Math.min(
                    64,
                    Math.max(1, Number($(cell).attr('colspan')) || 1),
                  ),
                0,
              ),
          ),
        );
        if (columns > 64)
          throw new BadRequestException('DOCX table contains too many columns');
        const cellWidth = Math.floor((options.width ?? BODY_WIDTH) / columns);
        const active = new Map<number, { remaining: number; span: number }>();
        const rowXml = rows
          .map((row) => {
            const cells = $(row).children('th,td').toArray();
            let col = 0;
            let content = '';
            const continuation = () => {
              const previous = active.get(col);
              if (!previous) return false;
              content += `<w:tc><w:tcPr><w:tcW w:w="${previous.span * cellWidth}" w:type="dxa"/>${previous.span > 1 ? `<w:gridSpan w:val="${previous.span}"/>` : ''}<w:vMerge/><w:vAlign w:val="center"/></w:tcPr><w:p/></w:tc>`;
              previous.remaining--;
              if (!previous.remaining) active.delete(col);
              col += previous.span;
              return true;
            };
            for (const cell of cells) {
              while (continuation()) {
                /* Preserve merged cells from preceding rows. */
              }
              const span = Math.min(
                columns - col,
                Math.max(1, Number($(cell).attr('colspan')) || 1),
              );
              if (span < 1)
                throw new BadRequestException('DOCX table has an invalid span');
              const rowSpan = Math.min(
                rows.length,
                Math.max(1, Number($(cell).attr('rowspan')) || 1),
              );
              if (rowSpan > 1)
                active.set(col, { remaining: rowSpan - 1, span });
              const body =
                blocks(
                  cell.children ?? [],
                  {
                    style: cell.name === 'th' ? 'TableHeading' : 'TableText',
                    width: cellWidth * span - 216,
                  },
                  depth + 1,
                ) || '<w:p/>';
              content += `<w:tc><w:tcPr><w:tcW w:w="${cellWidth * span}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${rowSpan > 1 ? '<w:vMerge w:val="restart"/>' : ''}${cell.name === 'th' ? '<w:shd w:fill="E9EEF4"/>' : ''}<w:vAlign w:val="center"/></w:tcPr>${body}${body.endsWith('</w:tbl>') ? '<w:p/>' : ''}</w:tc>`;
              col += span;
            }
            while (col < columns) {
              if (!continuation()) {
                content += '<w:tc><w:tcPr/><w:p/></w:tc>';
                col++;
              }
            }
            return `<w:tr>${cells.every((cell) => cell.name === 'th') ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${content}</w:tr>`;
          })
          .join('');
        const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
          .map(
            (side) => `<w:${side} w:val="single" w:sz="4" w:color="D9D9D9"/>`,
          )
          .join('');
        output += `<w:tbl><w:tblPr><w:tblW w:w="${options.width ?? BODY_WIDTH}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${borders}</w:tblBorders><w:tblCellMar><w:top w:w="90" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${Array.from({ length: columns }, () => `<w:gridCol w:w="${cellWidth}"/>`).join('')}</w:tblGrid>${rowXml}</w:tbl><w:p/>`;
      } else
        output += blocks(
          node.children ?? [],
          {
            ...options,
            ...($(node).attr('dir') === 'rtl' ? { rtl: true } : {}),
          },
          depth + 1,
        );
    }
    flush();
    return output;
  };
  const body = blocks($.root().contents().toArray());
  relation('styles', 'styles.xml');
  relation('numbering', 'numbering.xml');
  if (footnotes.length) relation('footnotes', 'footnotes.xml');
  const namespaces = `xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;
  zip.file(
    'word/document.xml',
    part(
      `<w:document ${namespaces}><w:body>${body || '<w:p/>'}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    ),
  );
  zip.file(
    'word/_rels/document.xml.rels',
    part(
      `<Relationships xmlns="${REL}">${relationships.join('')}</Relationships>`,
    ),
  );
  zip.file(
    '_rels/.rels',
    part(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    ),
  );
  const styles = (
    id: string,
    name: string,
    p: string,
    r: string,
    type = 'paragraph',
  ) =>
    `<w:style w:type="${type}" w:styleId="${id}"><w:name w:val="${name}"/>${type === 'paragraph' ? `<w:basedOn w:val="Normal"/><w:pPr>${p}</w:pPr>` : ''}<w:rPr>${r}</w:rPr></w:style>`;
  zip.file(
    'word/styles.xml',
    part(
      `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Arial"/><w:sz w:val="22"/><w:color w:val="000000"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${styles('Title', 'Title', '<w:keepNext/><w:spacing w:before="0" w:after="240"/>', '<w:b/><w:sz w:val="44"/><w:color w:val="000000"/>')}${Array.from({ length: 6 }, (_, i) => styles(`Heading${i + 1}`, `heading ${i + 1}`, `<w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${i}"/>`, `<w:b/><w:sz w:val="${[32, 28, 24, 22, 22, 22][i]}"/><w:color w:val="000000"/>`)).join('')}${styles('Code', 'Code', '<w:shd w:fill="F2F2F2"/>', '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/>')}${styles('TableText', 'Table text', '<w:spacing w:after="40"/>', '<w:sz w:val="20"/>')}${styles('TableHeading', 'Table heading', '<w:spacing w:after="40"/>', '<w:b/><w:sz w:val="20"/>')}${styles('FootnoteText', 'footnote text', '<w:spacing w:after="0"/>', '<w:sz w:val="18"/>')}${styles('FootnoteReference', 'footnote reference', '', '<w:vertAlign w:val="superscript"/>', 'character')}</w:styles>`,
    ),
  );
  const abstract = (ordered: boolean) =>
    `<w:abstractNum w:abstractNumId="${ordered ? 1 : 0}"><w:multiLevelType w:val="multilevel"/>${Array.from({ length: 9 }, (_, level) => `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${ordered ? 'decimal' : 'bullet'}"/><w:lvlText w:val="${ordered ? `%${level + 1}.` : '&#x2022;'}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="${(level + 1) * 360}"/></w:tabs><w:ind w:left="${(level + 1) * 360}" w:hanging="240"/></w:pPr></w:lvl>`).join('')}</w:abstractNum>`;
  zip.file(
    'word/numbering.xml',
    part(
      `<w:numbering xmlns:w="${W}">${abstract(false)}${abstract(true)}${numbering.join('')}</w:numbering>`,
    ),
  );
  if (footnotes.length)
    zip.file(
      'word/footnotes.xml',
      part(
        `<w:footnotes ${namespaces}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>${footnotes.join('')}</w:footnotes>`,
      ),
    );
  zip.file(
    'docProps/core.xml',
    part(
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(params.title)}</dc:title><dc:creator>Docmost</dc:creator></cp:coreProperties>`,
    ),
  );
  zip.file(
    '[Content_Types].xml',
    part(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...types].map((extension) => `<Default Extension="${extension}" ContentType="image/${extension === 'jpg' ? 'jpeg' : extension}"/>`).join('')}${[['document', 'document.main'], ['styles', 'styles'], ['numbering', 'numbering'], ...(footnotes.length ? [['footnotes', 'footnotes']] : [])].map(([file, type]) => `<Override PartName="/word/${file}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    ),
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
