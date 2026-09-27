import { jsonToNode } from '../../collaboration/collaboration.util';
import { Logger } from '@nestjs/common';
import { ExportFormat } from './dto/export-dto';
import { Node } from '@tiptap/pm/model';
import { validate as isValidUUID } from 'uuid';
import * as path from 'path';
import { createHash } from 'node:crypto';
import { Page } from '@docmost/db/types/entity.types';
import { isAttachmentNode } from '../../common/helpers/prosemirror/utils';

export type PageExportTree = Record<string, Page[]>;

/**
 * We only support canonical internal links format
 * `/s/:spaceSlug/p/:pageSlug` (with optional origin).
 * Legacy format `/p/:pageSlug` is no longer counted as active.
 */
export const INTERNAL_LINK_REGEX =
  /^(https?:\/\/)?([^\/]+)?\/s\/([^\/]+)\/p\/([a-zA-Z0-9-]+)\/?$/;

export function getExportExtension(format: string) {
  if (format === ExportFormat.HTML) {
    return '.html';
  }

  if (format === ExportFormat.Markdown) {
    return '.md';
  }

  if (format === ExportFormat.PDF) {
    return '.pdf';
  }
  return;
}

export function getPageTitle(title: string) {
  return title ? title : 'untitled';
}

export function updateAttachmentUrlsToLocalPaths(prosemirrorJson: any) {
  const doc = jsonToNode(prosemirrorJson);
  if (!doc) return null;

  // Helper function to replace specific URL prefixes
  const replacePrefix = (url: string): string => {
    const prefixes = ['/files', '/api/files'];
    for (const prefix of prefixes) {
      if (url.startsWith(prefix)) {
        return url.replace(prefix, 'files');
      }
    }
    return url;
  };

  doc?.descendants((node: Node) => {
    if (isAttachmentNode(node.type.name)) {
      if (node.attrs.src) {
        // @ts-ignore
        node.attrs.src = replacePrefix(node.attrs.src);
      }
      if (node.attrs.url) {
        // @ts-ignore
        node.attrs.url = replacePrefix(node.attrs.url);
      }
    }
  });

  return doc.toJSON();
}

export function replaceInternalLinks(
  prosemirrorJson: any,
  slugIdToPath: Record<string, string>,
  currentPagePath: string,
) {
  const doc = jsonToNode(prosemirrorJson);

  doc.descendants((node: Node) => {
    for (const mark of node.marks) {
      if (mark.type.name === 'link' && mark.attrs.href) {
        const match = mark.attrs.href.match(INTERNAL_LINK_REGEX);
        if (match) {
          const markLink = mark.attrs.href;

          const slugId = extractPageSlugId(match[4]);
          const localPath = slugIdToPath[slugId];

          if (!localPath) {
            continue;
          }

          const relativePath = computeRelativePath(currentPagePath, localPath);

          //@ts-expect-error
          mark.attrs.href = relativePath;
          //@ts-expect-error
          mark.attrs.target = '_self';
          if (node.isText) {
            // if link and text are same, use page title
            if (markLink === node.text) {
              //@ts-expect-error
              node.text = getInternalLinkPageName(
                relativePath,
                currentPagePath,
              );
            }
          }
        }
      }
    }
  });

  return doc.toJSON();
}

export function getInternalLinkPageName(
  path: string,
  currentFilePath?: string,
): string {
  const name = path?.split('/').pop().split('.').slice(0, -1).join('.');
  try {
    return decodeURIComponent(name);
  } catch (err) {
    if (currentFilePath) {
      Logger.warn(
        `URI malformed in page ${currentFilePath}: ${name}. Falling back to raw name.`,
        'ExportUtils',
      );
    }
    return name;
  }
}

export function extractPageSlugId(input: string): string {
  if (!input) {
    return undefined;
  }
  const parts = input.split('-');
  return parts.length > 1 ? parts[parts.length - 1] : input;
}

export function buildTree(pages: Page[]): PageExportTree {
  const tree: PageExportTree = Object.create(null);

  for (const page of pages) {
    const parentPageId = page.parentPageId;

    if (!tree[parentPageId]) {
      tree[parentPageId] = [];
    }
    tree[parentPageId].push(page);
  }
  return tree;
}

const RESERVED_EXPORT_NAME =
  /^(con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i;

function isUnsafeExportCharacter(character: string): boolean {
  return (
    /[<>:"/\\|?*]/.test(character) ||
    character.codePointAt(0)! < 32 ||
    character.codePointAt(0) === 127
  );
}

function safeExportSegment(title: string): string {
  const characters: string[] = [];
  let bytes = 0;
  for (const original of title.normalize('NFC')) {
    const character = isUnsafeExportCharacter(original) ? '_' : original;
    bytes += Buffer.byteLength(character, 'utf8');
    if (bytes > 160) break;
    characters.push(character);
  }
  let segment = characters.join('').replace(/[. ]+$/g, '');
  if (!segment || RESERVED_EXPORT_NAME.test(segment))
    segment = `page-${segment || 'untitled'}`;
  return segment;
}

export function assertSafeExportPath(value: string): void {
  const parts = value.replace(/\/$/, '').split('/');
  if (
    !value ||
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        Array.from(part).some(isUnsafeExportCharacter) ||
        /[. ]$/.test(part) ||
        RESERVED_EXPORT_NAME.test(part),
    )
  ) {
    throw new Error('Unsafe export archive path');
  }
}

export function createExportPathPlan(tree: PageExportTree, format: string) {
  const paths = new Map<string, { segment: string; zipPath: string }>();
  const pending: Array<{ parentId: string | null; directory: string }> = [
    { parentId: null, directory: '' },
  ];
  while (pending.length) {
    const { parentId, directory } = pending.pop()!;
    const used = new Set(['files', 'docmost-metadata.json']);
    for (const page of tree[parentId] ?? []) {
      const title = getPageTitle(page.title);
      const base = safeExportSegment(title);
      const suffix = createHash('sha256')
        .update(page.id)
        .digest('hex')
        .slice(0, 12);
      let segment = base === title ? base : `${base}-${suffix}`;
      let counter = 0;
      const occupied = () =>
        used.has(segment.toLowerCase()) ||
        used.has(`${segment}${getExportExtension(format)}`.toLowerCase());
      while (occupied())
        segment = `${base}-${suffix}${counter++ ? `-${counter}` : ''}`;
      used.add(segment.toLowerCase());
      used.add(`${segment}${getExportExtension(format)}`.toLowerCase());
      const zipPath = `${directory}${segment}${getExportExtension(format)}`;
      assertSafeExportPath(zipPath);
      paths.set(page.id, { segment, zipPath });
      pending.push({ parentId: page.id, directory: `${directory}${segment}/` });
    }
  }
  return paths;
}

function computeRelativePath(from: string, to: string) {
  return path.posix
    .relative(path.posix.dirname(from), to)
    .split('/')
    .map((segment) =>
      segment === '..' ? segment : encodeURIComponent(segment),
    )
    .join('/');
}
