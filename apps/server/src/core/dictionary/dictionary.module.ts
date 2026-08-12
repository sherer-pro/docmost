import { Module } from '@nestjs/common';
import { DictionaryController } from './dictionary.controller';
import { DictionaryService } from './dictionary.service';
import { DictionaryWordFormService } from './dictionary-word-form.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [DictionaryController],
  providers: [DictionaryService, DictionaryWordFormService],
  exports: [DictionaryService],
})
export class DictionaryModule {}
