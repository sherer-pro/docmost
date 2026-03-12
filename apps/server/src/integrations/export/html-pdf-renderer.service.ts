import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'node:fs';
import puppeteer, { Browser } from 'puppeteer-core';
import { EnvironmentService } from '../environment/environment.service';

const FALLBACK_CHROMIUM_PATHS = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

interface RenderPdfOptions {
  attachmentToken?: string;
}

@Injectable()
export class HtmlPdfRendererService {
  private readonly logger = new Logger(HtmlPdfRendererService.name);

  constructor(private readonly environmentService: EnvironmentService) {}

  async render(htmlDocument: string, opts: RenderPdfOptions = {}): Promise<Buffer> {
    const browser = await this.launchBrowser();
    let page: Awaited<ReturnType<Browser['newPage']>> | null = null;

    try {
      const timeout = this.environmentService.getPdfRenderTimeoutMs();
      page = await browser.newPage();
      page.setDefaultNavigationTimeout(timeout);
      page.setDefaultTimeout(timeout);
      const attachmentToken = opts.attachmentToken?.trim();
      if (attachmentToken) {
        await page.setExtraHTTPHeaders({
          'x-attachment-token': attachmentToken,
        });
      }

      await page.setContent(htmlDocument, {
        waitUntil: 'networkidle0',
        timeout,
      });
      await this.renderMermaidDiagrams(page);

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margin: {
          top: '16mm',
          right: '12mm',
          bottom: '16mm',
          left: '12mm',
        },
      });

      return Buffer.from(pdfBuffer);
    } finally {
      if (page) {
        await page.close();
      }
      await browser.close();
    }
  }

  private async renderMermaidDiagrams(
    page: Awaited<ReturnType<Browser['newPage']>>,
  ): Promise<void> {
    const hasMermaidBlocks = await page.evaluate(() => {
      return Boolean(
        document.querySelector(
          'pre code.language-mermaid, pre code[class*="language-mermaid"], pre code[data-language="mermaid"]',
        ),
      );
    });

    if (!hasMermaidBlocks) {
      return;
    }

    const mermaidScriptPath = this.resolveMermaidScriptPath();
    if (!mermaidScriptPath) {
      return;
    }

    try {
      await page.addScriptTag({ path: mermaidScriptPath });
      await page.evaluate(async () => {
        const mermaid = (window as any).mermaid;
        if (!mermaid) {
          return;
        }

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          theme: 'default',
        });

        const codeNodes = Array.from(
          document.querySelectorAll(
            'pre code.language-mermaid, pre code[class*="language-mermaid"], pre code[data-language="mermaid"]',
          ),
        );

        let renderedCount = 0;
        for (const codeNode of codeNodes) {
          const preNode = codeNode.closest('pre');
          if (!preNode) {
            continue;
          }

          const source = codeNode.textContent || '';
          if (!source.trim()) {
            continue;
          }

          try {
            const renderId = `docmost-mermaid-${renderedCount++}`;
            const renderResult = await mermaid.render(renderId, source);
            const figure = document.createElement('figure');
            figure.className = 'docmost-mermaid-figure';
            figure.innerHTML = renderResult.svg;
            preNode.replaceWith(figure);
          } catch (err) {
            // Keep the original Mermaid source block if rendering fails.
          }
        }
      });
    } catch (err) {
      this.logger.warn('Failed to render Mermaid diagrams for PDF export', err);
    }
  }

  private resolveMermaidScriptPath(): string | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require.resolve('mermaid/dist/mermaid.min.js');
    } catch (err) {
      this.logger.warn(
        'Mermaid package is unavailable. Mermaid code blocks will be exported as text.',
      );
      return null;
    }
  }

  private async launchBrowser(): Promise<Browser> {
    const executablePath = this.resolveChromiumExecutablePath();

    return puppeteer.launch({
      executablePath,
      headless: true,
      timeout: this.environmentService.getPdfRenderTimeoutMs(),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--font-render-hinting=medium',
      ],
    });
  }

  private resolveChromiumExecutablePath(): string {
    const configuredPath = this.environmentService.getPdfChromiumExecutablePath();
    if (configuredPath) {
      return configuredPath;
    }

    const detectedPath = FALLBACK_CHROMIUM_PATHS.find((path) => existsSync(path));
    if (detectedPath) {
      this.logger.debug(
        `Using detected Chromium executable path for PDF export: ${detectedPath}`,
      );
      return detectedPath;
    }

    throw new Error(
      'Unable to resolve Chromium executable path for PDF export. Set PDF_CHROMIUM_EXECUTABLE_PATH.',
    );
  }
}
