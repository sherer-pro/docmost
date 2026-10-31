import { Injectable } from '@nestjs/common';
import { fetch } from 'undici';
import {
  parseIntegrationPreviewUrl,
  type IntegrationPreviewTarget,
} from '@docmost/editor-ext/server';
import type { IntegrationPreviewProvider } from '@docmost/api-contract';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { AiOutboundUrlPolicyService } from '../ai/services/ai-outbound-url-policy.service';
import { createAiPinnedDispatcher } from '../ai/services/ai-pinned-http.util';

const INTEGRATION_PREVIEW_ORIGINS: Record<
  IntegrationPreviewProvider,
  string
> = {
  github: 'https://api.github.com',
  gitlab: 'https://gitlab.com',
  figma: 'https://api.figma.com',
};

@Injectable()
export class IntegrationPreviewHttpService {
  constructor(
    private readonly environment: EnvironmentService,
    private readonly policy: AiOutboundUrlPolicyService,
  ) {}

  availableProviders(): IntegrationPreviewProvider[] {
    const allowed = new Set(
      this.environment
        .getIntegrationPreviewAllowedOrigins()
        .split(',')
        .map((origin) => origin.trim()),
    );
    return (
      Object.keys(INTEGRATION_PREVIEW_ORIGINS) as IntegrationPreviewProvider[]
    ).filter((provider) => allowed.has(INTEGRATION_PREVIEW_ORIGINS[provider]));
  }

  async read(
    target: IntegrationPreviewTarget,
    token: string | null,
    etag?: string,
  ) {
    const parsed = parseIntegrationPreviewUrl(target.url);
    if (
      !parsed ||
      parsed.provider !== target.provider ||
      parsed.apiPath !== target.apiPath
    )
      throw new Error('Invalid integration preview target');
    const resolved = await this.policy.resolveAllowed(
      INTEGRATION_PREVIEW_ORIGINS[target.provider] + target.apiPath,
      {
        kind: 'integration-preview',
        allowedOrigins: this.environment.getIntegrationPreviewAllowedOrigins(),
        allowQuery: false,
        requireExplicitOrigin: true,
        denyLoopback: true,
      },
    );
    const pinned = createAiPinnedDispatcher(resolved.addresses);
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'User-Agent': 'Docmost-Link-Previews',
      };
      if (target.provider === 'github') {
        headers.Accept = 'application/vnd.github+json';
        headers['X-GitHub-Api-Version'] = '2026-03-10';
      }
      if (
        etag &&
        etag.length <= 256 &&
        [...etag].every(
          (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) <= 126,
        )
      )
        headers['If-None-Match'] = etag;
      if (token)
        headers[
          target.provider === 'github'
            ? 'Authorization'
            : target.provider === 'gitlab'
              ? 'PRIVATE-TOKEN'
              : 'X-Figma-Token'
        ] = target.provider === 'github' ? `Bearer ${token}` : token;
      const response = await fetch(resolved.url, {
        method: 'GET',
        headers,
        dispatcher: pinned.dispatcher,
        redirect: 'error',
        signal: AbortSignal.timeout(7000),
      });
      if (response.status === 304 || !response.ok) {
        await response.body?.cancel();
        return { status: response.status, data: null, etag: null };
      }
      if (
        !/\b(?:application\/json|application\/[a-z0-9.-]+\+json)\b/i.test(
          response.headers.get('content-type') ?? '',
        )
      )
        throw new Error('Expected JSON metadata');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Missing metadata body');
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const item = await reader.read();
          if (item.done) break;
          size += item.value.byteLength;
          if (size > 1024 * 1024)
            throw new Error('Integration metadata exceeds its size bound');
          chunks.push(item.value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new Error('Invalid metadata object');
      return {
        status: response.status,
        data: data as Record<string, any>,
        etag: response.headers.get('etag')?.slice(0, 256) ?? null,
      };
    } finally {
      await pinned.close();
    }
  }
}
