import { Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { PageExportController, SpaceExportController } from './export.controller';
import { StorageModule } from '../storage/storage.module';
import { HtmlPdfRendererService } from './html-pdf-renderer.service';
import { TokenModule } from '../../core/auth/token.module';
import { CopyMarkdownWithCommentsService } from './copy-markdown-with-comments.service';

@Module({
  imports: [StorageModule, TokenModule],
  providers: [
    ExportService,
    HtmlPdfRendererService,
    CopyMarkdownWithCommentsService,
  ],
  exports: [
    ExportService,
    HtmlPdfRendererService,
    CopyMarkdownWithCommentsService,
  ],
  controllers: [PageExportController, SpaceExportController],
})
export class ExportModule {}
