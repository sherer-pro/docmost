import { Module } from '@nestjs/common';
import { TransclusionController } from './transclusion.controller';
import { TransclusionService } from './transclusion.service';
import { PageEmbedService } from './page-embed.service';
import { PageTemplatePolicyService } from './page-template-policy.service';
import { PageEmbedGraphLockService } from './page-embed-graph-lock.service';

const transclusionProviders = [
  TransclusionService,
  PageEmbedService,
  PageTemplatePolicyService,
  PageEmbedGraphLockService,
];

@Module({
  controllers: [TransclusionController],
  providers: transclusionProviders,
  exports: transclusionProviders,
})
export class TransclusionModule {}

/**
 * Sync-only composition used by the collaboration process. It deliberately
 * exposes no HTTP controllers and does not pull the full page/ACL module tree.
 */
@Module({
  providers: transclusionProviders,
  exports: transclusionProviders,
})
export class TransclusionPersistenceModule {}
