import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fsp } from 'node:fs';
import * as JSZip from 'jszip';
import {
  createZipReadBudget,
  extractZip,
  readZipEntryWithBudget,
  ZipBudgetExceededError,
} from './file.utils';

async function writeZip(
  outputPath: string,
  entries: Record<string, string | Buffer>,
): Promise<void> {
  const zip = new JSZip();

  for (const [entryName, content] of Object.entries(entries)) {
    zip.file(entryName, content);
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  await fsp.writeFile(outputPath, zipBuffer);
}

describe('extractZip', () => {
  let tempRoot: string;
  let targetDir: string;
  let archivePath: string;
  let warnSpy: jest.SpyInstance;

  beforeEach(async () => {
    tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'docmost-zip-'));
    targetDir = path.join(tempRoot, 'target');
    archivePath = path.join(tempRoot, 'archive.zip');
    await fsp.mkdir(targetDir, { recursive: true });
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('prevents parent-directory traversal and keeps valid files', async () => {
    await writeZip(archivePath, {
      '../escape.txt': 'pwned',
      'safe.md': '# Safe',
    });

    await extractZip(archivePath, targetDir);

    expect(fs.existsSync(path.join(tempRoot, 'escape.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(targetDir, 'safe.md'), 'utf8')).toBe(
      '# Safe',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[security][zip-entry-rejected]'),
    );
    expect(
      warnSpy.mock.calls.some(([message]) =>
        String(message).includes('reason=invalid-entry'),
      ),
    ).toBe(true);
  });

  it('normalizes absolute-path entries into the target directory', async () => {
    await writeZip(archivePath, {
      '/absolute-escape.txt': 'pwned',
    });

    await extractZip(archivePath, targetDir);

    expect(fs.existsSync(path.join(tempRoot, 'absolute-escape.txt'))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(targetDir, 'absolute-escape.txt'))).toBe(
      true,
    );
  });

  it('rejects Windows traversal entries', async () => {
    await writeZip(archivePath, {
      '..\\windows-escape.txt': 'pwned',
    });

    await extractZip(archivePath, targetDir);

    expect(fs.existsSync(path.join(tempRoot, 'windows-escape.txt'))).toBe(
      false,
    );
  });

  it('does not allow nested zip traversal bypasses', async () => {
    const innerZip = new JSZip();
    innerZip.file('../nested-escape.txt', 'pwned');
    innerZip.file('nested/safe.txt', 'safe');
    const innerZipBuffer = await innerZip.generateAsync({ type: 'nodebuffer' });

    await writeZip(archivePath, {
      'payload.zip': innerZipBuffer,
    });

    await extractZip(archivePath, targetDir);

    expect(fs.existsSync(path.join(tempRoot, 'nested-escape.txt'))).toBe(false);
    expect(
      fs.readFileSync(path.join(targetDir, 'nested', 'safe.txt'), 'utf8'),
    ).toBe('safe');
  });

  it('rejects archives with too many entries', async () => {
    await writeZip(archivePath, {
      'one.md': 'one',
      'two.md': 'two',
      'three.md': 'three',
    });

    await expect(
      extractZip(archivePath, targetDir, { maxEntries: 2 }),
    ).rejects.toThrow(/entry count/);
  });

  it('rejects archives exceeding the total uncompressed size quota', async () => {
    await writeZip(archivePath, {
      'large.md': '0123456789',
    });

    await expect(
      extractZip(archivePath, targetDir, {
        maxTotalUncompressedBytes: 5,
      }),
    ).rejects.toThrow(/total uncompressed size/);

    expect(fs.existsSync(path.join(targetDir, 'large.md'))).toBe(false);
  });
});

describe('readZipEntryWithBudget', () => {
  async function loadEntry(content: Buffer | string, entryName = 'data.json') {
    const zip = new JSZip();
    zip.file(entryName, content);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const loaded = await JSZip.loadAsync(buffer);

    return loaded.file(entryName)!;
  }

  it('returns the decompressed entry content when it fits the budget', async () => {
    const entry = await loadEntry('{"schemaVersion":2}');
    const budget = createZipReadBudget();

    const result = await readZipEntryWithBudget(entry, budget);

    expect(result.toString('utf8')).toBe('{"schemaVersion":2}');
    expect(budget.totalBytesRead).toBe(19);
  });

  it('aborts a highly compressible entry that inflates past the per-entry budget', async () => {
    // 8 MiB of zeroes compresses to a few KiB: exactly the shape of a zip bomb.
    const entry = await loadEntry(Buffer.alloc(8 * 1024 * 1024, 0));
    const budget = createZipReadBudget({
      maxEntryUncompressedBytes: 64 * 1024,
    });

    await expect(readZipEntryWithBudget(entry, budget)).rejects.toBeInstanceOf(
      ZipBudgetExceededError,
    );
  });

  it('enforces the cumulative budget across several entries', async () => {
    const budget = createZipReadBudget({
      maxEntryUncompressedBytes: 1024 * 1024,
      maxTotalUncompressedBytes: 96 * 1024,
    });

    const first = await loadEntry(Buffer.alloc(64 * 1024, 0), 'first.bin');
    await readZipEntryWithBudget(first, budget);
    expect(budget.totalBytesRead).toBe(64 * 1024);

    const second = await loadEntry(Buffer.alloc(64 * 1024, 0), 'second.bin');
    await expect(readZipEntryWithBudget(second, budget)).rejects.toThrow(
      /total uncompressed size/,
    );
  });

  it('does not trust the declared uncompressed size recorded in the archive', async () => {
    const entry = await loadEntry(Buffer.alloc(4 * 1024 * 1024, 0));
    // Spoof the central-directory size the way a crafted archive would.
    (entry as any)._data.uncompressedSize = 1;

    const budget = createZipReadBudget({
      maxEntryUncompressedBytes: 32 * 1024,
    });

    await expect(readZipEntryWithBudget(entry, budget)).rejects.toBeInstanceOf(
      ZipBudgetExceededError,
    );
  });
});
