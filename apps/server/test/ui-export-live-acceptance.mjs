import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { verifyNativePdfLinkClick } from './native-pdf-link-click.mjs';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const cheerio = require('cheerio');
const exec = promisify(execFile);

function pageEntry(zip, metadata, pageId) {
  const encoded = Object.entries(metadata.pages).find(
    ([, page]) => page.pageId === pageId,
  )?.[0];
  assert(encoded, 'Exported page metadata is missing');
  const entry = zip.file(decodeURIComponent(encoded));
  assert(entry, 'Page metadata must resolve to a real ZIP member');
  return entry;
}

function resolveArchiveUrl(entry, href) {
  assert.equal(typeof href, 'string', 'The exported URL is missing');
  const base = `https://portable-export.invalid/${entry.name.split('/').map(encodeURIComponent).join('/')}`;
  const url = new URL(href, base);
  assert.equal(
    url.origin,
    'https://portable-export.invalid',
    'The portable resource must not need the source origin',
  );
  assert.equal(
    url.search,
    '',
    'Portable resources must not contain an authorization query',
  );
  assert.equal(
    url.hash,
    '',
    'Portable resource paths must encode literal hash characters',
  );
  return decodeURIComponent(url.pathname.slice(1));
}

export async function runUiExportAcceptance({
  api,
  fetchApi,
  actors,
  space,
  parent,
  fixture,
  test,
  output,
}) {
  let root, child, childRoute, sourceOrigin;
  const receipt = {
    pdfViewerClick:
      'not measured; actual annotations are checked separately from viewer clicks',
  };
  await test('HTML ZIP attachment URLs resolve to exact owned image bytes in root and child pages without authorization queries or foreign rewrites', async () => {
    root = await api(actors.admin, '/pages', 'POST', {
      spaceId: space.id,
      parentPageId: parent.id,
      title: 'Portable export parent % #',
    });
    child = await api(actors.admin, '/pages', 'POST', {
      spaceId: space.id,
      parentPageId: root.id,
      title: 'Portable export child 日本 %',
    });
    const info = await fetchApi(
      actors.reader,
      `/pages/info?pageId=${child.id}`,
    );
    assert.equal(
      info.status(),
      200,
      'The child source must be readable by the permitted reader',
    );
    sourceOrigin = new URL(info.url()).origin;
    childRoute = `/s/${space.slug}/p/${child.slugId}`;
    const { createCanvas } = require('@napi-rs/canvas');
    const upload = async (page, color, name) => {
      const canvas = createCanvas(128, 48);
      const context = canvas.getContext('2d');
      context.fillStyle = color;
      context.fillRect(0, 0, 128, 48);
      const bytes = canvas.toBuffer('image/png');
      const attachment = await api(
        actors.admin,
        `/attachments/actions/upload-file?pageId=${page.id}`,
        'POST',
        undefined,
        {
          multipart: {
            pageId: page.id,
            file: { name, mimeType: 'image/png', buffer: bytes },
          },
        },
      );
      return { attachment, bytes };
    };
    const rootImage = await upload(
      root,
      '#304d80',
      'export image 日本 % #.png',
    );
    const childImage = await upload(
      child,
      '#804d30',
      'child image 日本 % #.png',
    );
    const canonical = `/api/attachments/files/${rootImage.attachment.id}/${encodeURIComponent(rootImage.attachment.fileName)}`;
    const fakeAuthorization = 'synthetic-export-auth-marker';
    const foreign = `https://foreign.example.test/api/attachments/files/${rootImage.attachment.id}/foreign.png?source=foreign`;
    const references = [
      ['Canonical owned image', `${canonical}?jwt=${fakeAuthorization}`],
      [
        'Legacy owned image',
        `/api/files/${rootImage.attachment.id}/old-name.png?jwt=${fakeAuthorization}`,
      ],
      [
        'Public owned image',
        `/api/attachments/files/public/${rootImage.attachment.id}/old-name.png?jwt=${fakeAuthorization}`,
      ],
      [
        'Absolute owned image',
        `${sourceOrigin}${canonical}?jwt=${fakeAuthorization}`,
      ],
      ['Foreign URL unchanged', foreign],
    ];
    const imageNode = (attachment, src, alt) => ({
      type: 'image',
      attrs: {
        id: randomUUID(),
        attachmentId: attachment.id,
        src,
        alt,
        width: 128,
      },
    });
    const linkNode = (text, href) => ({
      type: 'text',
      text,
      marks: [{ type: 'link', attrs: { href } }],
    });
    await api(actors.admin, '/pages/actions/update', 'POST', {
      pageId: root.id,
      format: 'json',
      operation: 'replace',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              linkNode('OPEN_PORTABLE_CHILD', childRoute),
              { type: 'text', text: ' ' },
              linkNode(
                'EXTERNAL_EXPORT_REFERENCE',
                'https://example.test/export-reference',
              ),
            ],
          },
          ...references.map(([alt, src]) =>
            imageNode(rootImage.attachment, src, alt),
          ),
        ],
      },
    });
    await api(actors.admin, '/pages/actions/update', 'POST', {
      pageId: child.id,
      format: 'json',
      operation: 'replace',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'PORTABLE_CHILD_BODY' }],
          },
          imageNode(
            childImage.attachment,
            `/api/attachments/files/${childImage.attachment.id}/${encodeURIComponent(childImage.attachment.fileName)}?jwt=${fakeAuthorization}`,
            'Child owned image',
          ),
        ],
      },
    });
    const download = async (includeAttachments) => {
      const response = await fetchApi(
        actors.editor,
        '/pages/actions/export',
        'POST',
        {
          pageId: root.id,
          format: 'html',
          includeChildren: true,
          includeAttachments,
        },
      );
      assert.equal(response.status(), 200, 'HTML portable export failed');
      const bytes = await response.body();
      await writeFile(
        path.join(
          output,
          `ui-export-html-${includeAttachments ? 'with' : 'without'}-attachments.zip`,
        ),
        bytes,
      );
      const zip = await JSZip.loadAsync(bytes);
      const metadata = JSON.parse(
        await zip.file('docmost-metadata.json').async('string'),
      );
      return { zip, metadata };
    };
    const { zip, metadata } = await download(true);
    const rootEntry = pageEntry(zip, metadata, root.id);
    const childEntry = pageEntry(zip, metadata, child.id);
    const rootHtml = await rootEntry.async('string');
    const $ = cheerio.load(rootHtml);
    const paths = [];
    for (const [alt] of references.slice(0, 4)) {
      const src = $(`img[alt="${alt}"]`).attr('src');
      assert(src, 'The owned image must survive HTML rendering');
      const target = resolveArchiveUrl(rootEntry, src);
      const member = zip.file(target);
      assert(
        member,
        'The owned image URL must resolve inside the downloaded ZIP',
      );
      assert.deepEqual(await member.async('nodebuffer'), rootImage.bytes);
      assert(
        src.endsWith(encodeURIComponent(rootImage.attachment.fileName)),
        'Image paths must encode the actual included filename',
      );
      assert(
        src.includes('%25'),
        'The uploaded filename must retain its encoded literal percent',
      );
      paths.push({ alt, src, archivePath: target });
    }
    assert.equal($('img[alt="Foreign URL unchanged"]').attr('src'), foreign);
    assert(
      !rootHtml.includes(fakeAuthorization),
      'Included image URLs must not retain authorization parameters',
    );
    const childHtml = await childEntry.async('string');
    const childSrc = cheerio
      .load(childHtml)('img[alt="Child owned image"]')
      .attr('src');
    const childTarget = resolveArchiveUrl(childEntry, childSrc);
    assert(
      zip.file(childTarget),
      'The child image must use its actual folder-relative member',
    );
    assert.deepEqual(
      await zip.file(childTarget).async('nodebuffer'),
      childImage.bytes,
    );
    assert(!childHtml.includes(fakeAuthorization));
    const childHref = $('a')
      .filter((_, element) => $(element).text() === 'OPEN_PORTABLE_CHILD')
      .attr('href');
    assert(
      childHref.includes('%25') &&
        childHref.includes('%23') &&
        childHref.includes('%20'),
      'Archive page paths must encode literal percent, hash and space characters',
    );
    assert.equal(
      resolveArchiveUrl(rootEntry, childHref),
      childEntry.name,
      'HTML page links remain archive-relative',
    );
    const without = await download(false);
    assert(
      !Object.keys(without.zip.files).some(
        (name) => name.startsWith('files/') || name.includes('/files/'),
      ),
    );
    const withoutRoot = cheerio.load(
      await pageEntry(without.zip, without.metadata, root.id).async('string'),
    );
    assert.equal(
      withoutRoot('img[alt="Canonical owned image"]').attr('src'),
      `${canonical}?jwt=${fakeAuthorization}`,
    );
    receipt.html = {
      rootPath: rootEntry.name,
      childPath: childEntry.name,
      localImages: paths,
      childImage: { src: childSrc, archivePath: childTarget },
      foreignUrlPreserved: true,
      attachmentsOffPreserved: true,
      rootImageSha256: createHash('sha256')
        .update(rootImage.bytes)
        .digest('hex'),
      childImageSha256: createHash('sha256')
        .update(childImage.bytes)
        .digest('hex'),
    };
  });

  await test('Actual PDF annotations keep canonical source page links while child PDFs remain included', async () => {
    const response = await fetchApi(
      actors.editor,
      '/pages/actions/export',
      'POST',
      {
        pageId: root.id,
        format: 'pdf',
        includeChildren: true,
        includeAttachments: true,
      },
    );
    assert.equal(response.status(), 200, 'PDF child-link export failed');
    const bytes = await response.body();
    await writeFile(path.join(output, 'ui-export-pdf.zip'), bytes);
    const zip = await JSZip.loadAsync(bytes);
    const metadata = JSON.parse(
      await zip.file('docmost-metadata.json').async('string'),
    );
    const rootEntry = pageEntry(zip, metadata, root.id);
    const childEntry = pageEntry(zip, metadata, child.id);
    const pdf = await rootEntry.async('nodebuffer');
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.equal(
      (await childEntry.async('nodebuffer')).subarray(0, 5).toString(),
      '%PDF-',
    );
    const target = path.join(output, 'ui-export-parent.pdf');
    await writeFile(target, pdf);
    const parsed = await exec(
      process.env.DOCMOST_PYTHON ?? 'python',
      [
        '-c',
        'import json,sys,pdfplumber\nwith pdfplumber.open(sys.argv[1]) as document:\n print(json.dumps([{ "page": index + 1, "uri": link["uri"], "width": page.width, "height": page.height, "rotation": page.rotation, "rect": { key: link[key] for key in ["x0", "x1", "top", "bottom"] } } for index,page in enumerate(document.pages) for link in page.hyperlinks]))',
        target,
      ],
      { windowsHide: true, maxBuffer: 1000000, timeout: 30000 },
    );
    const annotations = JSON.parse(parsed.stdout);
    const expected = new URL(childRoute, sourceOrigin).href;
    assert(
      annotations.some((link) => link.uri === expected),
      'The PDF annotation must open the canonical Docmost child route',
    );
    assert(
      annotations.some(
        (link) => link.uri === 'https://example.test/export-reference',
      ),
      'External PDF links must remain unchanged',
    );
    assert(
      !annotations.some(
        (link) =>
          new URL(link.uri, sourceOrigin).origin === sourceOrigin &&
          /\.(?:html|md|pdf)$/i.test(new URL(link.uri, sourceOrigin).pathname),
      ),
      'Source links must not resolve to an archive filename on APP_URL',
    );
    await writeFile(
      path.join(output, 'ui-export-pdf-annotations.json'),
      JSON.stringify(annotations, null, 2),
    );
    receipt.pdf = {
      rootPath: rootEntry.name,
      childPath: childEntry.name,
      canonicalChildLink: expected,
      annotations,
      sourcePageAclRead: true,
    };
    receipt.pdfViewerClick = await verifyNativePdfLinkClick({
      pdf,
      annotation: annotations.find((link) => link.uri === expected),
      expectedUrl: expected,
      pageId: child.id,
      storageState: await actors.reader.api.storageState(),
      output,
    });
    await writeFile(
      path.join(output, 'ui-export-receipt.json'),
      JSON.stringify(receipt, null, 2),
    );
    fixture.uiExport = {
      pageId: root.id,
      route: `/s/${space.slug}/p/${root.slugId}`,
      childPageId: child.id,
      childRoute,
    };
  });
}
