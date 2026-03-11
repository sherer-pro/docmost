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

@Injectable()
export class HtmlPdfRendererService {
  private readonly logger = new Logger(HtmlPdfRendererService.name);

  constructor(private readonly environmentService: EnvironmentService) {}

  async render(htmlDocument: string): Promise<Buffer> {
    const browser = await this.launchBrowser();
    let page: Awaited<ReturnType<Browser['newPage']>> | null = null;

    try {
      const timeout = this.environmentService.getPdfRenderTimeoutMs();
      page = await browser.newPage();
      page.setDefaultNavigationTimeout(timeout);
      page.setDefaultTimeout(timeout);

      await page.setContent(htmlDocument, {
        waitUntil: 'networkidle0',
        timeout,
      });

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
