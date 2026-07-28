import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { ShareModule } from '../share/share.module';

@Module({
  imports: [ShareModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
