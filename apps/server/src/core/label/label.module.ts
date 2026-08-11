import { Module } from '@nestjs/common';
import { LabelController } from './label.controller';
import { LabelService } from './label.service';
import { LabelPersistenceModule } from '../../database/persistence/label-persistence.module';

@Module({
  imports: [LabelPersistenceModule],
  controllers: [LabelController],
  providers: [LabelService],
  exports: [LabelService],
})
export class LabelModule {}
