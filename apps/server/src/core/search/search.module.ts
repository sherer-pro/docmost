import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { ShareModule } from '../share/share.module';
import { TypesenseIndexService } from './typesense-index.service';
import { TypesenseSearchService } from './typesense-search.service';
import { SearchProcessor } from './search.processor';

@Module({
  imports: [ShareModule],
  controllers: [SearchController],
  providers: [
    SearchService,
    TypesenseIndexService,
    TypesenseSearchService,
    SearchProcessor,
  ],
  exports: [SearchService],
})
export class SearchModule {}
