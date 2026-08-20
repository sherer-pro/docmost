import { Module } from '@nestjs/common';
import { DictionaryController } from './dictionary.controller';
import { DictionaryService } from './dictionary.service';
import { DictionaryWordFormService } from './dictionary-word-form.service';
import { AiProviderModule } from '../ai/ai-provider.module';
import { DictionarySearchService } from './dictionary-search.service';

@Module({
  imports: [AiProviderModule],
  controllers: [DictionaryController],
  providers: [
    DictionaryService,
    DictionaryWordFormService,
    DictionarySearchService,
  ],
  exports: [DictionaryService, DictionarySearchService],
})
export class DictionaryModule {}
