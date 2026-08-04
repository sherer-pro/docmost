import { Module } from '@nestjs/common';
import { TransclusionController } from './transclusion.controller';
import { TransclusionService } from './transclusion.service';
import { PageTemplatePolicyService } from './page-template-policy.service';

@Module({
  controllers: [TransclusionController],
  providers: [TransclusionService, PageTemplatePolicyService],
  exports: [TransclusionService, PageTemplatePolicyService],
})
export class TransclusionModule {}

