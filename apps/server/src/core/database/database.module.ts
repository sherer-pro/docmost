import { Module } from '@nestjs/common';
import { DatabaseController } from './database.controller';
import { DatabaseService } from './services/database.service';
import { PageModule } from '../page/page.module';
import { ExportModule } from '../../integrations/export/export.module';

@Module({
  imports: [PageModule, ExportModule],
  controllers: [DatabaseController],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
