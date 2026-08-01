import { Module } from '@nestjs/common';
import { ShareController } from './share.controller';
import { ShareService } from './share.service';
import { TokenModule } from '../auth/token.module';
import { ShareSeoController } from './share-seo.controller';
import { TransclusionModule } from '../page/transclusion/transclusion.module';
import { PublicSharingPolicyService } from './public-sharing-policy.service';

@Module({
  imports: [TokenModule, TransclusionModule],
  controllers: [ShareController, ShareSeoController],
  providers: [ShareService, PublicSharingPolicyService],
  exports: [ShareService, PublicSharingPolicyService],
})
export class ShareModule {}
