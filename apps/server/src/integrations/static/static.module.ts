import { Module, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { basename, join, normalize, sep } from 'path';
import * as fs from 'node:fs';
import fastifyStatic from '@fastify/static';
import { EnvironmentService } from '../environment/environment.service';
import { resolveClientDistPath } from '../../common/utils/client-dist-path';

export const WINDOW_CONFIG_PLACEHOLDER = '<!--window-config-->';
export const WINDOW_CONFIG_SCRIPT_TAG = '<script src="/window-config.js"></script>';
export const HTML_CACHE_CONTROL = 'no-store, max-age=0';
export const SERVICE_WORKER_CACHE_CONTROL =
  'no-cache, no-store, max-age=0, must-revalidate';
export const IMMUTABLE_ASSET_CACHE_CONTROL =
  'public, max-age=31536000, immutable';

export function injectWindowConfigScript(html: string): string {
  if (html.includes(WINDOW_CONFIG_PLACEHOLDER)) {
    return html.replace(WINDOW_CONFIG_PLACEHOLDER, WINDOW_CONFIG_SCRIPT_TAG);
  }

  if (html.includes(WINDOW_CONFIG_SCRIPT_TAG)) {
    return html;
  }

  return html.replace('</body>', `${WINDOW_CONFIG_SCRIPT_TAG}\n  </body>`);
}

export function getClientStaticCacheControl(filePath: string): string | null {
  const fileName = basename(filePath);

  if (fileName === 'sw.js' || fileName === 'manifest.json') {
    return SERVICE_WORKER_CACHE_CONTROL;
  }

  if (normalize(filePath).split(sep).includes('assets')) {
    return IMMUTABLE_ASSET_CACHE_CONTROL;
  }

  return null;
}

@Module({})
export class StaticModule implements OnModuleInit {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly environmentService: EnvironmentService,
  ) {}

  public async onModuleInit() {
    const httpAdapter = this.httpAdapterHost.httpAdapter;
    const app = httpAdapter.getInstance();

    const clientDistPath = resolveClientDistPath(__dirname);

    if (!clientDistPath) {
      this.registerRootFallback(app);
      return;
    }

    const indexFilePath = join(clientDistPath, 'index.html');

    if (fs.existsSync(clientDistPath) && fs.existsSync(indexFilePath)) {
      const configString = {
        ENV: this.environmentService.getNodeEnv(),
        APP_URL: this.environmentService.getAppUrl(),
        CLOUD: this.environmentService.isCloud(),
        FILE_UPLOAD_SIZE_LIMIT:
          this.environmentService.getFileUploadSizeLimit(),
        FILE_IMPORT_SIZE_LIMIT:
          this.environmentService.getFileImportSizeLimit(),
        EMBED_ALLOWED_ORIGINS:
          this.environmentService.getEmbedAllowedOrigins(),
        DRAWIO_URL: this.environmentService.getDrawioUrl(),
        SUBDOMAIN_HOST: this.environmentService.isCloud()
          ? this.environmentService.getSubdomainHost()
          : undefined,
        COLLAB_URL: this.environmentService.getCollabUrl(),
        BILLING_TRIAL_DAYS: this.environmentService.isCloud()
          ? this.environmentService.getBillingTrialDays()
          : undefined,
        POSTHOG_HOST: this.environmentService.getPostHogHost(),
        POSTHOG_KEY: this.environmentService.getPostHogKey(),
      };

      const windowConfigScriptContent = `window.CONFIG=${JSON.stringify(configString)};`;
      const html = fs.readFileSync(indexFilePath, 'utf8');
      const transformedHtml = injectWindowConfigScript(html);

      const RENDER_PATH = '*';

      app.get('/window-config.js', (_req: any, res: any) => {
        res
          .header('Cache-Control', HTML_CACHE_CONTROL)
          .type('application/javascript; charset=utf-8')
          .send(windowConfigScriptContent);
      });

      await app.register(fastifyStatic, {
        root: clientDistPath,
        wildcard: false,
        setHeaders(res: any, pathName: string) {
          const cacheControl = getClientStaticCacheControl(pathName);

          if (cacheControl) {
            res.setHeader('Cache-Control', cacheControl);
          }
        },
      });

      app.get(RENDER_PATH, (_req: any, res: any) => {
        res
          .header('Cache-Control', HTML_CACHE_CONTROL)
          .type('text/html; charset=utf-8')
          .send(transformedHtml);
      });

      return;
    }

    this.registerRootFallback(app);
  }

  /**
   * Registers a fallback handler for the root route when the frontend is not built.
   * For browser requests, returns an explanatory HTML page with HTTP 503,
   * so the situation is not masked as a successful full web application startup.
   */
  private registerRootFallback(app: any) {
    app.get('/', (_req: any, res: any) => {
      const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Docmost server is running</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        background: #0b1020;
        color: #e6edf3;
      }
      main {
        width: min(680px, calc(100vw - 32px));
        background: #111827;
        border: 1px solid #374151;
        border-radius: 12px;
        padding: 24px;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 22px;
      }
      p {
        margin: 0 0 12px;
        line-height: 1.5;
      }
      code {
        background: #1f2937;
        border-radius: 6px;
        padding: 2px 6px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Docmost server is running</h1>
      <p>Client assets are not available on this backend instance.</p>
      <p>For local development run <code>pnpm client:dev</code>.</p>
      <p>For production/static serving run <code>pnpm build</code> before starting the server.</p>
    </main>
  </body>
</html>`;

      res.code(503).type('text/html; charset=utf-8').send(html);
    });
  }
}
