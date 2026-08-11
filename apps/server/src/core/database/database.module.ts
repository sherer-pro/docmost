import { Module } from '@nestjs/common';
import { DatabaseController } from './database.controller';
import { DatabaseService } from './services/database.service';
import { DatabaseExportService } from './services/database-export.service';
import { PageModule } from '../page/page.module';
import { ExportModule } from '../../integrations/export/export.module';

@Module({
  imports: [PageModule, ExportModule],
  controllers: [DatabaseController],
  providers: [DatabaseService, DatabaseExportService],
  exports: [DatabaseService],
})
export class DatabaseFeatureModule {}
