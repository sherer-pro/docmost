import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { ShareModule } from '../share/share.module';
import { TypesenseIndexService } from './typesense-index.service';
import { TypesenseSearchService } from './typesense-search.service';
import { SearchProcessor } from './search.processor';
import { DictionaryModule } from '../dictionary/dictionary.module';
import { DatabaseFeatureModule } from '../database/database.module';
import { SearchOperationalMetricsService } from './search-operational-metrics.service';

@Module({
  imports: [ShareModule, DictionaryModule, DatabaseFeatureModule],
  controllers: [SearchController],
  providers: [
    SearchService,
    TypesenseIndexService,
    TypesenseSearchService,
    SearchProcessor,
    SearchOperationalMetricsService,
  ],
  exports: [SearchService],
})
export class SearchModule {}
