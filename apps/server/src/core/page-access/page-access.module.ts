import { Global, Module } from '@nestjs/common';
import { PageAccessService } from './page-access.service';
import { PageModule } from '../page/page.module';

@Global()
@Module({
  imports: [PageModule],
  providers: [PageAccessService],
  exports: [PageAccessService],
})
export class PageAccessModule {}
