import { Module } from '@nestjs/common';
import { LabelRepo } from '../repos/label/label.repo';

@Module({
  providers: [LabelRepo],
  exports: [LabelRepo],
})
export class LabelPersistenceModule {}
