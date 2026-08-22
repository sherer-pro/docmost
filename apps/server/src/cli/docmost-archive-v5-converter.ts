import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { DOCMOST_ARCHIVE_SCHEMA_VERSION } from '@docmost/api-contract';
import { v5 as uuid5 } from 'uuid';

const CONVERTIBLE_SCHEMA_VERSIONS = new Set([2, 3, 4, 5]);
const MAX_LEGACY_EMBED_DEPTH = 20;
const PAGE_EMBED_ATTACHMENT_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

type JsonRecord = Record<string, any>;

type LegacyPageEmbedSnapshot = {
  referencePageId?: string;
  referenceNodeId?: string;
  sourcePageId?: string;
  content?: unknown;
};

export type DocmostArchiveV5ConversionReport = {
  materializedPageEmbeds: number;
  unavailablePageEmbeds: number;
};

export type DocmostArchiveV5Conversion = {
  value: unknown;
  report: DocmostArchiveV5ConversionReport;
};

export async function convertDocmostArchivePath(
  inputPath: string,
  outputPath: string,
): Promise<DocmostArchiveV5ConversionReport> {
  const input = resolve(inputPath);
  const output = resolve(outputPath);
  if (input === output) {
    throw new Error('Input and output paths must be different');
  }

  const inputStat = await stat(input);
  if (inputStat.isFile()) {
    const conversion = convertDocmostArchiveJson(
      JSON.parse(await readFile(input, 'utf8')),
    );
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(conversion.value, null, 2)}\n`, {
      flag: 'wx',
    });
    return conversion.report;
  }

  if (!inputStat.isDirectory()) {
    throw new Error(
      'Input must be a JSON file or an extracted archive directory',
    );
  }

  const outputRelativeToInput = relative(input, output);
  if (
    outputRelativeToInput === '' ||
    (!outputRelativeToInput.startsWith('..') &&
      !isAbsolute(outputRelativeToInput))
  ) {
    throw new Error('Output directory must not be inside the input directory');
  }
  await assertOutputDoesNotExist(output);

  const dataInput = resolve(input, 'docmost-data.json');
  const metadataInput = resolve(input, 'docmost-metadata.json');
  const [dataConversion, metadataConversion] = await Promise.all([
    readAndConvertJson(dataInput),
    readAndConvertJson(metadataInput),
  ]);

  await mkdir(dirname(output), { recursive: true });
  await cp(input, output, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  await Promise.all([
    writeFile(
      resolve(output, 'docmost-data.json'),
      `${JSON.stringify(dataConversion.value, null, 2)}\n`,
    ),
    writeFile(
      resolve(output, 'docmost-metadata.json'),
      `${JSON.stringify(metadataConversion.value, null, 2)}\n`,
    ),
  ]);

  return mergeReports(dataConversion.report, metadataConversion.report);
}

export function convertDocmostArchiveJson(
  input: unknown,
): DocmostArchiveV5Conversion {
  if (!isRecord(input)) {
    throw new Error('Docmost archive JSON must be an object');
  }

  if (isRecord(input.manifest) && isRecord(input.data)) {
    const manifest = convertManifest(input.manifest);
    const data = convertData(input.data);
    return {
      value: { ...structuredClone(input), manifest, data: data.value },
      report: data.report,
    };
  }

  if (input.source === 'docmost' && input.dataFile === 'docmost-data.json') {
    return {
      value: convertManifest(input),
      report: emptyReport(),
    };
  }

  if (Array.isArray(input.pages)) {
    return convertData(input);
  }

  throw new Error(
    'JSON is neither a Docmost manifest, archive data, nor a manifest/data bundle',
  );
}

function convertManifest(input: JsonRecord): JsonRecord {
  assertConvertibleVersion(input.schemaVersion);
  if (containsPageEmbed(input)) {
    throw new Error('Docmost archive manifest cannot contain pageEmbed nodes');
  }
  return {
    ...structuredClone(input),
    schemaVersion: DOCMOST_ARCHIVE_SCHEMA_VERSION,
  };
}

function convertData(input: JsonRecord): DocmostArchiveV5Conversion {
  assertConvertibleVersion(input.schemaVersion);
  const attachmentById = new Map<string, JsonRecord>();
  for (const attachment of Array.isArray(input.attachments)
    ? input.attachments
    : []) {
    if (isRecord(attachment) && typeof attachment.id === 'string') {
      attachmentById.set(attachment.id, attachment);
    }
  }
  const generatedAttachments = new Map<string, JsonRecord>();
  const attachmentCopiesByConsumer = new Map<string, Map<string, string>>();
  const copyAttachmentForConsumer = (
    sourceAttachmentId: string,
    consumerPageId: string | undefined,
  ): string => {
    if (!consumerPageId) {
      throw new Error(
        `Cannot materialize legacy pageEmbed attachment ${sourceAttachmentId} without a consumer page`,
      );
    }
    const sourceAttachment = attachmentById.get(sourceAttachmentId);
    if (!sourceAttachment) {
      throw new Error(
        `Legacy pageEmbed attachment metadata is missing for ${sourceAttachmentId}`,
      );
    }
    let copies = attachmentCopiesByConsumer.get(consumerPageId);
    if (!copies) {
      copies = new Map<string, string>();
      attachmentCopiesByConsumer.set(consumerPageId, copies);
    }
    const existing = copies.get(sourceAttachmentId);
    if (existing) return existing;

    const copiedId = uuid5(
      `docmost-page-embed-attachment:${consumerPageId}:${sourceAttachmentId}`,
      PAGE_EMBED_ATTACHMENT_NAMESPACE,
    );
    if (attachmentById.has(copiedId) || generatedAttachments.has(copiedId)) {
      throw new Error(
        `Deterministic pageEmbed attachment id collides with archive metadata: ${copiedId}`,
      );
    }
    copies.set(sourceAttachmentId, copiedId);
    generatedAttachments.set(copiedId, {
      ...structuredClone(sourceAttachment),
      id: copiedId,
      pageId: consumerPageId,
    });
    return copiedId;
  };

  const sourcePages = new Map<string, unknown>();
  for (const page of input.pages) {
    if (isRecord(page) && typeof page.id === 'string') {
      sourcePages.set(page.id, normalizeRichContent(page.content));
    }
  }

  const snapshots = Array.isArray(input.pageEmbedSnapshots)
    ? (input.pageEmbedSnapshots.filter(isRecord) as LegacyPageEmbedSnapshot[])
    : [];
  const exactSnapshots = new Map<string, LegacyPageEmbedSnapshot>();
  const snapshotsBySource = new Map<string, LegacyPageEmbedSnapshot>();
  for (const snapshot of snapshots) {
    if (typeof snapshot.sourcePageId !== 'string') continue;
    if (!snapshotsBySource.has(snapshot.sourcePageId)) {
      snapshotsBySource.set(snapshot.sourcePageId, snapshot);
    }
    if (
      typeof snapshot.referencePageId === 'string' &&
      typeof snapshot.referenceNodeId === 'string'
    ) {
      exactSnapshots.set(
        snapshotKey(snapshot.referencePageId, snapshot.referenceNodeId),
        snapshot,
      );
    }
  }

  const report = emptyReport();
  const convertValue = (
    value: unknown,
    referencePageId: string | undefined,
    consumerPageId: string | undefined,
    ancestors: ReadonlySet<string>,
    depth: number,
    materialized: boolean,
  ): unknown => {
    if (Array.isArray(value)) {
      return value.flatMap((item) => {
        const converted = convertValue(
          item,
          referencePageId,
          consumerPageId,
          ancestors,
          depth,
          materialized,
        );
        return Array.isArray(converted) ? converted : [converted];
      });
    }
    if (!isRecord(value)) return value;

    if (value.type === 'pageEmbed') {
      const sourcePageId =
        typeof value.attrs?.sourcePageId === 'string'
          ? value.attrs.sourcePageId
          : undefined;
      const referenceNodeId =
        typeof value.attrs?.id === 'string' ? value.attrs.id : undefined;
      const exact =
        referencePageId && referenceNodeId
          ? exactSnapshots.get(snapshotKey(referencePageId, referenceNodeId))
          : undefined;
      const sourceContent = sourcePageId
        ? (exact?.content ??
          sourcePages.get(sourcePageId) ??
          snapshotsBySource.get(sourcePageId)?.content)
        : undefined;

      if (
        !sourcePageId ||
        sourceContent === undefined ||
        ancestors.has(sourcePageId) ||
        depth >= MAX_LEGACY_EMBED_DEPTH
      ) {
        report.unavailablePageEmbeds += 1;
        return unavailablePageEmbedCallout();
      }

      const sourceDocument = parseDocument(sourceContent);
      if (!sourceDocument || !Array.isArray(sourceDocument.content)) {
        report.unavailablePageEmbeds += 1;
        return unavailablePageEmbedCallout();
      }

      report.materializedPageEmbeds += 1;
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(sourcePageId);
      return sourceDocument.content.flatMap((child: unknown) => {
        const converted = convertValue(
          child,
          sourcePageId,
          consumerPageId,
          nextAncestors,
          depth + 1,
          true,
        );
        return Array.isArray(converted) ? converted : [converted];
      });
    }

    const converted: JsonRecord = {};
    for (const [key, child] of Object.entries(value)) {
      converted[key] = convertValue(
        child,
        referencePageId,
        consumerPageId,
        ancestors,
        depth,
        materialized,
      );
    }
    if (
      materialized &&
      isRecord(converted.attrs) &&
      typeof converted.attrs.attachmentId === 'string'
    ) {
      const sourceAttachmentId = converted.attrs.attachmentId;
      const copiedId = copyAttachmentForConsumer(
        sourceAttachmentId,
        consumerPageId,
      );
      converted.attrs.attachmentId = copiedId;
      for (const key of ['src', 'url']) {
        if (typeof converted.attrs[key] === 'string') {
          converted.attrs[key] = converted.attrs[key]
            .split(sourceAttachmentId)
            .join(copiedId);
        }
      }
    }
    return converted;
  };

  const convertConsumerOwnedRichContent = (
    value: unknown,
    consumerPageId: unknown,
    fieldLabel: string,
  ): unknown => {
    if (!containsPageEmbed(value)) return structuredClone(value);
    const normalized = normalizeRichContent(value);
    if (
      typeof consumerPageId !== 'string' ||
      !sourcePages.has(consumerPageId)
    ) {
      throw new Error(
        `Cannot convert legacy pageEmbed in ${fieldLabel} without a known consumer page`,
      );
    }
    return convertValue(
      normalized,
      consumerPageId,
      consumerPageId,
      new Set([consumerPageId]),
      0,
      false,
    );
  };

  const output = structuredClone(input) as JsonRecord;
  delete output.pageEmbedSnapshots;
  output.schemaVersion = DOCMOST_ARCHIVE_SCHEMA_VERSION;
  output.pages = input.pages.map((page: unknown) => {
    const pageId =
      isRecord(page) && typeof page.id === 'string' ? page.id : undefined;
    const normalizedPage = isRecord(page)
      ? {
          ...structuredClone(page),
          content: normalizeRichContent(page.content),
        }
      : page;
    return convertValue(
      normalizedPage,
      pageId,
      pageId,
      new Set(pageId ? [pageId] : []),
      0,
      false,
    );
  });
  output.databases = Array.isArray(input.databases)
    ? input.databases.map((database: unknown) => {
        if (!isRecord(database)) return structuredClone(database);
        const converted = structuredClone(database) as JsonRecord;
        if ('descriptionContent' in database) {
          converted.descriptionContent = convertConsumerOwnedRichContent(
            database.descriptionContent,
            database.pageId,
            `database ${typeof database.id === 'string' ? database.id : '<unknown>'} description`,
          );
        }
        return converted;
      })
    : structuredClone(input.databases);
  output.databaseCells = Array.isArray(input.databaseCells)
    ? input.databaseCells.map((cell: unknown) => {
        if (!isRecord(cell)) return structuredClone(cell);
        const converted = structuredClone(cell) as JsonRecord;
        if ('value' in cell) {
          converted.value = convertConsumerOwnedRichContent(
            cell.value,
            cell.pageId,
            `database cell ${typeof cell.id === 'string' ? cell.id : '<unknown>'}`,
          );
        }
        return converted;
      })
    : structuredClone(input.databaseCells);

  for (const [key, value] of Object.entries(output)) {
    if (
      key === 'pages' ||
      key === 'databases' ||
      key === 'databaseCells' ||
      key === 'schemaVersion'
    ) {
      continue;
    }
    output[key] = convertValue(
      value,
      undefined,
      undefined,
      new Set(),
      0,
      false,
    );
  }
  if (generatedAttachments.size > 0) {
    output.attachments = [
      ...(Array.isArray(output.attachments) ? output.attachments : []),
      ...generatedAttachments.values(),
    ];
  }

  if (containsPageEmbed(output)) {
    throw new Error('Converted archive still contains a pageEmbed node');
  }

  return { value: output, report };
}

function parseDocument(value: unknown): JsonRecord | null {
  let parsed = value;
  for (
    let attempt = 0;
    attempt < 2 && typeof parsed === 'string';
    attempt += 1
  ) {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!isRecord(parsed)) return null;
  return parsed.type === 'doc'
    ? parsed
    : {
        type: 'doc',
        content: Array.isArray(parsed.content) ? parsed.content : [],
      };
}

function normalizeRichContent(value: unknown): unknown {
  if (typeof value !== 'string') return structuredClone(value);
  let parsed: unknown = value;
  for (
    let attempt = 0;
    attempt < 2 && typeof parsed === 'string';
    attempt += 1
  ) {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      if (
        typeof parsed === 'string' &&
        /"type"\s*:\s*"pageEmbed"/.test(parsed)
      ) {
        throw new Error(
          'Legacy rich-content string contains an unparseable pageEmbed node',
        );
      }
      return parsed;
    }
  }
  return parsed;
}

function unavailablePageEmbedCallout(): JsonRecord {
  return {
    type: 'callout',
    attrs: { type: 'info', icon: null },
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Embedded page content was unavailable during offline archive conversion.',
          },
        ],
      },
    ],
  };
}

function containsPageEmbed(input: unknown): boolean {
  const stack = [input];
  const seen = new WeakSet<object>();
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value === 'string') {
      if (!value.includes('pageEmbed')) continue;
      try {
        stack.push(JSON.parse(value));
      } catch {
        if (/"type"\s*:\s*"pageEmbed"/.test(value)) return true;
      }
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    if (seen.has(value)) continue;
    seen.add(value);
    if (!Array.isArray(value) && (value as JsonRecord).type === 'pageEmbed') {
      return true;
    }
    stack.push(...(Array.isArray(value) ? value : Object.values(value)));
  }
  return false;
}

function assertConvertibleVersion(version: unknown): void {
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    !CONVERTIBLE_SCHEMA_VERSIONS.has(version)
  ) {
    throw new Error(
      'Only Docmost archive schema versions 2, 3, 4, and 5 can be converted',
    );
  }
}

function snapshotKey(referencePageId: string, referenceNodeId: string): string {
  return `${referencePageId}::${referenceNodeId}`;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function emptyReport(): DocmostArchiveV5ConversionReport {
  return { materializedPageEmbeds: 0, unavailablePageEmbeds: 0 };
}

function mergeReports(
  left: DocmostArchiveV5ConversionReport,
  right: DocmostArchiveV5ConversionReport,
): DocmostArchiveV5ConversionReport {
  return {
    materializedPageEmbeds:
      left.materializedPageEmbeds + right.materializedPageEmbeds,
    unavailablePageEmbeds:
      left.unavailablePageEmbeds + right.unavailablePageEmbeds,
  };
}

async function readAndConvertJson(
  path: string,
): Promise<DocmostArchiveV5Conversion> {
  return convertDocmostArchiveJson(JSON.parse(await readFile(path, 'utf8')));
}

async function assertOutputDoesNotExist(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Output path already exists: ${path}`);
}
