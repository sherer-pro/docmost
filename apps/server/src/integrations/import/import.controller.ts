import {
  BadRequestException,
  Body,
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
import { ConfirmDocmostImportDto, FileTaskIdDto } from './dto/file-task-dto';
import WorkspaceAbilityFactory from '../../core/casl/abilities/workspace-ability.factory';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../../core/casl/interfaces/workspace-ability.type';
import { AuthPolicyScope } from '../../common/decorators/auth-policy-scope.decorator';

@Controller('pages')
export class ImportController {
  private readonly logger = new Logger(ImportController.name);

  constructor(
    private readonly importService: ImportService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
    private readonly environmentService: EnvironmentService,
  ) {}

  /**
   * New command-style endpoint: imports a single page into the target space.
   */
  @UseInterceptors(FileInterceptor)
  @UseGuards(JwtAuthGuard)
  @AuthPolicyScope('space', { source: 'query', key: 'spaceId' })
  @HttpCode(HttpStatus.OK)
  @Post('actions/import')
  async importPageAction(
    @Req() req: any,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.handleImportPage(req, user, workspace);
  }

  private async handleImportPage(req: any, user: User, workspace: Workspace) {
    const validFileExtensions = ['.md', '.html'];

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
   * New command-style endpoint: bulk import of a zip package.
   */
  @UseInterceptors(FileInterceptor)
  @UseGuards(JwtAuthGuard)
  @AuthPolicyScope('space', { source: 'query', key: 'spaceId' })
  @HttpCode(HttpStatus.OK)
  @Post('actions/import-zip')
  async importZipAction(
    @Req() req: any,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.handleImportZip(req, user, workspace);
  }

  @UseInterceptors(FileInterceptor)
  @UseGuards(JwtAuthGuard)
  @AuthPolicyScope('space', { source: 'query', key: 'spaceId' })
  @HttpCode(HttpStatus.OK)
  @Post('actions/import-zip/preview')
  async previewImportZipAction(
    @Req() req: any,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.handleImportZip(req, user, workspace, true);
  }

  @UseGuards(JwtAuthGuard)
  @AuthPolicyScope('resource', {
    source: 'body',
    key: 'fileTaskId',
    resourceType: 'fileTask',
  })
  @HttpCode(HttpStatus.OK)
  @Post('actions/import-zip/confirm')
  async confirmImportZipAction(
    @Body() dto: ConfirmDocmostImportDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const spaceId = await this.importService.getPendingDocmostImportSpaceId(
      dto.fileTaskId,
      user.id,
      workspace.id,
    );
    const spaceAbility = await this.spaceAbility.createForUser(user, spaceId);
    const workspaceAbility = this.workspaceAbility.createForUser(
      user,
      workspace,
    );
    const canManageSpaceSettings = spaceAbility.can(
      SpaceCaslAction.Manage,
      SpaceCaslSubject.Settings,
    );
    const canImportDictionary = workspaceAbility.can(
      WorkspaceCaslAction.Manage,
      WorkspaceCaslSubject.Settings,
    );
    if (
      (dto.applyDocumentFields || dto.applyHeadingNumbering) &&
      !canManageSpaceSettings
    ) {
      throw new ForbiddenException(
        'You cannot apply imported settings to the target space',
      );
    }
    if (dto.applyDictionary && !canImportDictionary) {
      throw new ForbiddenException(
        'Only workspace administrators can import dictionary terms',
      );
    }
    return this.importService.confirmDocmostImport(
      dto.fileTaskId,
      {
        applyDocumentFields: dto.applyDocumentFields,
        applyDictionary: dto.applyDictionary,
        applyHeadingNumbering: dto.applyHeadingNumbering,
        cleanupLegacyHeadingNumbers: dto.cleanupLegacyHeadingNumbers ?? true,
      },
      user.id,
      workspace.id,
    );
  }

  @UseGuards(JwtAuthGuard)
  @AuthPolicyScope('resource', {
    source: 'body',
    key: 'fileTaskId',
    resourceType: 'fileTask',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('actions/import-zip/cancel')
  async cancelImportZipAction(
    @Body() dto: FileTaskIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    await this.importService.cancelDocmostImport(
      dto.fileTaskId,
      user.id,
      workspace.id,
    );
  }

  private async handleImportZip(
    req: any,
    user: User,
    workspace: Workspace,
    preview = false,
  ) {
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

    const validZipSources = ['docmost', 'generic', 'notion'];
    if (!validZipSources.includes(source)) {
      throw new BadRequestException(
        'Invalid import source. Import source must be docmost, generic or notion.',
      );
    }
    if (preview && source !== 'docmost') {
      throw new BadRequestException(
        'Preview is only available for Docmost archives',
      );
    }
    if (!preview && source === 'docmost') {
      throw new BadRequestException(
        'Docmost archives must be previewed before import',
      );
    }

    if (!spaceId) {
      throw new BadRequestException('spaceId is required');
    }

    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    if (preview) {
      const workspaceAbility = this.workspaceAbility.createForUser(
        user,
        workspace,
      );
      const canManageSpaceSettings = ability.can(
        SpaceCaslAction.Manage,
        SpaceCaslSubject.Settings,
      );
      return this.importService.previewDocmostZip(
        file,
        user.id,
        spaceId,
        workspace.id,
        {
          documentFields: canManageSpaceSettings,
          headingNumbering: canManageSpaceSettings,
          dictionary: workspaceAbility.can(
            WorkspaceCaslAction.Manage,
            WorkspaceCaslSubject.Settings,
          ),
        },
      );
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
