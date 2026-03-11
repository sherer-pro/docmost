import { Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { PageExportController, SpaceExportController } from './export.controller';
import { StorageModule } from '../storage/storage.module';
import { HtmlPdfRendererService } from './html-pdf-renderer.service';

@Module({
  imports: [StorageModule],
  providers: [ExportService, HtmlPdfRendererService],
  exports: [ExportService, HtmlPdfRendererService],
  controllers: [PageExportController, SpaceExportController],
})
export class ExportModule {}
