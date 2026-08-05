import { DynamicModule, Global, Module } from '@nestjs/common';
import { PageAccessService } from './page-access.service';
import { PageModule } from '../page/page.module';

@Global()
@Module({})
export class PageAccessModule {
  static forRoot(): DynamicModule {
    return {
      module: PageAccessModule,
      imports: [PageModule],
      providers: [PageAccessService],
      exports: [PageAccessService],
    };
  }

  static forCollaboration(): DynamicModule {
    return {
      module: PageAccessModule,
      providers: [PageAccessService],
      exports: [PageAccessService],
    };
  }
}
