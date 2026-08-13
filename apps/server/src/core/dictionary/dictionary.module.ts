import { Module } from '@nestjs/common';
import { DictionaryController } from './dictionary.controller';
import { DictionaryService } from './dictionary.service';
import { DictionaryWordFormService } from './dictionary-word-form.service';
import { AiProviderModule } from '../ai/ai-provider.module';

@Module({
  imports: [AiProviderModule],
  controllers: [DictionaryController],
  providers: [DictionaryService, DictionaryWordFormService],
  exports: [DictionaryService],
})
export class DictionaryModule {}
