import {
  BadRequestException,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import SpaceAbilityFactory from '../../core/casl/abilities/space-ability.factory';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../core/casl/interfaces/space-ability.type';
import { FileInterceptor } from '../../common/interceptors/file.interceptor';
import * as bytes from 'bytes';
import { ImportService } from './services/import.service';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { EnvironmentService } from '../environment/environment.service';
import { Readable } from 'stream';
import {
  SAFE_FILE_VALIDATION_ERROR_MESSAGE,
  validateFileExtensionAndSignature,
} from '../../common/helpers/file-validation';

@Controller('pages')
export class ImportController {
  private readonly logger = new Logger(ImportController.name);

  constructor(
    private readonly importService: ImportService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly environmentService: EnvironmentService,
  ) {}

  /**
   * Командный endpoint нового формата: импортирует одну страницу в целевой space.
   */
  @UseInterceptors(FileInterceptor)
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('actions/import')
  async importPageAction(
    @Req() req: any,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.handleImportPage(req, user, workspace);
  }

  /**
   * @deprecated Временный alias для обратной совместимости. Используйте /pages/actions/import.
   */
  @UseInterceptors(FileInterceptor)
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('import')
  async importPage(
    @Req() req: any,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.handleImportPage(req, user, workspace);
  }

  private async handleImportPage(
    req: any,
    user: User,
    workspace: Workspace,
  ) {
    const validFileExtensions = ['.md', '.html', '.docx'];

    const maxFileSize = bytes('10mb');

    let file = null;
    try {
      file = await req.file({
        limits: { fileSize: maxFileSize, fields: 4, files: 1 },
      });
    } catch (err: any) {
      this.logger.error(err.message);
      if (err?.statusCode === 413) {
        throw new BadRequestException(
          `File too large. Exceeds the 10mb import limit`,
        );
      }
    }

    if (!file) {
      throw new BadRequestException('Failed to upload file');
    }

    const fileBuffer = await file.toBuffer();

    await validateFileExtensionAndSignature({
      fileName: file.filename,
      fileBuffer,
      allowedExtensions: validFileExtensions,
      safeErrorMessage: SAFE_FILE_VALIDATION_ERROR_MESSAGE,
    });

    // Restore multipart buffer access for downstream import processing.
    file.toBuffer = async () => fileBuffer;

    const spaceId = file.fields?.spaceId?.value;

    if (!spaceId) {
      throw new BadRequestException('spaceId is required');
    }

    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    return this.importService.importPage(file, user.id, spaceId, workspace.id);
  }

  /**
   * Командный endpoint нового формата: массовый импорт zip-пакета.
   */
  @UseInterceptors(FileInterceptor)
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('actions/import-zip')
  async importZipAction(
    @Req() req: any,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.handleImportZip(req, user, workspace);
  }

  /**
   * @deprecated Временный alias для обратной совместимости. Используйте /pages/actions/import-zip.
   */
  @UseInterceptors(FileInterceptor)
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('import-zip')
  async importZip(
    @Req() req: any,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.handleImportZip(req, user, workspace);
  }

  private async handleImportZip(req: any, user: User, workspace: Workspace) {
    const validFileExtensions = ['.zip'];

    const maxFileSize = bytes(this.environmentService.getFileImportSizeLimit());

    let file = null;
    try {
      file = await req.file({
        limits: { fileSize: maxFileSize, fields: 3, files: 1 },
      });
    } catch (err: any) {
      this.logger.error(err.message);
      if (err?.statusCode === 413) {
        throw new BadRequestException(
          `File too large. Exceeds the ${this.environmentService.getFileImportSizeLimit()} import limit`,
        );
      }
    }

    if (!file) {
      throw new BadRequestException('Failed to upload file');
    }

    const fileBuffer = await file.toBuffer();

    await validateFileExtensionAndSignature({
      fileName: file.filename,
      fileBuffer,
      allowedExtensions: validFileExtensions,
      safeErrorMessage: SAFE_FILE_VALIDATION_ERROR_MESSAGE,
    });

    // Restore both buffer and stream access for zip import downstream.
    file.toBuffer = async () => fileBuffer;
    file.file = Readable.from(fileBuffer);

    const spaceId = file.fields?.spaceId?.value;
    const source = file.fields?.source?.value;

    const validZipSources = ['generic', 'notion', 'confluence'];
    if (!validZipSources.includes(source)) {
      throw new BadRequestException(
        'Invalid import source. Import source must either be generic, notion or confluence.',
      );
    }

    if (!spaceId) {
      throw new BadRequestException('spaceId is required');
    }

    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    return this.importService.importZip(
      file,
      source,
      user.id,
      spaceId,
      workspace.id,
    );
  }
}
