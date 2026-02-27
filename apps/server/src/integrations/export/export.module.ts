import { Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { PageExportController, SpaceExportController } from './export.controller';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  providers: [ExportService],
  controllers: [PageExportController, SpaceExportController],
})
export class ExportModule {}
