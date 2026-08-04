import { Module } from '@nestjs/common';
import { TransclusionController } from './transclusion.controller';
import { TransclusionService } from './transclusion.service';
import { PageEmbedService } from './page-embed.service';
import { PageTemplatePolicyService } from './page-template-policy.service';
import { PageEmbedGraphLockService } from './page-embed-graph-lock.service';

@Module({
  controllers: [TransclusionController],
  providers: [
    TransclusionService,
    PageEmbedService,
    PageTemplatePolicyService,
    PageEmbedGraphLockService,
  ],
  exports: [
    TransclusionService,
    PageEmbedService,
    PageTemplatePolicyService,
    PageEmbedGraphLockService,
  ],
})
export class TransclusionModule {}
