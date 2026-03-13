import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fsp } from 'node:fs';
import * as JSZip from 'jszip';
import { extractZip } from './file.utils';

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
});
