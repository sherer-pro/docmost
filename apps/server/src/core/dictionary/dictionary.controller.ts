import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { UserRole } from '../../common/helpers/types/permission';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import { DictionaryService } from './dictionary.service';
import {
  CreateDictionaryTermDto,
  ExportDictionaryTermsDto,
  GenerateAllDictionaryWordFormsDto,
  GenerateDictionaryWordFormsDto,
  ImportDictionaryTermsDto,
  ListDictionaryTermsQueryDto,
  UpdateDictionaryTermDto,
} from './dto/dictionary-term.dto';
import { DictionaryWordFormService } from './dictionary-word-form.service';
import { FastifyReply } from 'fastify';
import { AuthPolicyScope } from '../../common/decorators/auth-policy-scope.decorator';

@UseGuards(JwtAuthGuard)
@Controller('dictionary-terms')
export class DictionaryController {
  constructor(
    private readonly dictionaryService: DictionaryService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly wordForms: DictionaryWordFormService,
  ) {}

  @AuthPolicyScope('space', { source: 'query', key: 'spaceId' })
  @Get()
  async list(
    @Query() query: ListDictionaryTermsQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = await this.spaceAbility.createForUser(user, query.spaceId);

    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    return this.dictionaryService.listTerms(query.spaceId, workspace.id);
  }

  @AuthPolicyScope('space', { source: 'query', key: 'spaceId' })
  @Get('word-form-generation/status')
  async getWordFormGenerationStatus(
    @Query() query: ListDictionaryTermsQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    if (!this.isWorkspaceAdmin(user)) {
      const ability = await this.spaceAbility.createForUser(
        user,
        query.spaceId,
      );
      if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }
    }

    return this.wordForms.getAvailability(query.spaceId, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', { source: 'body', key: 'spaceId' })
  @Post('actions/generate-word-forms')
  async generateWordForms(
    @Body() dto: GenerateDictionaryWordFormsDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = await this.spaceAbility.createForUser(user, dto.spaceId);
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    return this.wordForms.generateForms(dto.spaceId, workspace.id, {
      term: dto.term,
      forms: dto.forms ?? [],
    });
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', { source: 'body', key: 'spaceId' })
  @Post('actions/generate-all-word-forms')
  async generateAllWordForms(
    @Body() dto: GenerateAllDictionaryWordFormsDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    if (!this.isWorkspaceAdmin(user)) {
      throw new ForbiddenException(
        'Only workspace admins can generate word forms for all dictionary terms',
      );
    }

    return this.wordForms.generateAndSaveAll(dto.spaceId, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', { source: 'body', key: 'spaceId' })
  @Post('actions/export')
  async exportTerms(
    @Body() dto: ExportDictionaryTermsDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Res() res: FastifyReply,
  ) {
    this.assertCanImportExportDictionary(user);

    const exported = await this.dictionaryService.exportTerms(
      dto.spaceId,
      workspace.id,
    );
    const fileName = `dictionary-${dto.spaceId}.json`;

    res.headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition':
        'attachment; filename="' + encodeURIComponent(fileName) + '"',
    });

    res.send(JSON.stringify(exported, null, 2));
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', { source: 'body', key: 'spaceId' })
  @Post('actions/import')
  async importTermsAction(
    @Body() dto: ImportDictionaryTermsDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.assertCanImportExportDictionary(user);

    return this.dictionaryService.importTerms(
      dto.spaceId,
      dto.terms,
      user,
      workspace.id,
    );
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('space', { source: 'body', key: 'spaceId' })
  @Post()
  async create(
    @Body() dto: CreateDictionaryTermDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = await this.spaceAbility.createForUser(user, dto.spaceId);

    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    return this.dictionaryService.createTerm(dto, user, workspace.id);
  }

  @AuthPolicyScope('resource', {
    key: 'termId',
    resourceType: 'dictionaryTerm',
  })
  @Patch(':termId')
  async update(
    @Param('termId', ParseUUIDPipe) termId: string,
    @Body() dto: UpdateDictionaryTermDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const existingTerm = await this.dictionaryService.getTermForPermission(
      termId,
      workspace.id,
    );
    const ability = await this.spaceAbility.createForUser(
      user,
      existingTerm.spaceId,
    );

    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    return this.dictionaryService.updateTerm(termId, dto, workspace.id);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @AuthPolicyScope('resource', {
    key: 'termId',
    resourceType: 'dictionaryTerm',
  })
  @Delete(':termId')
  async remove(
    @Param('termId', ParseUUIDPipe) termId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const existingTerm = await this.dictionaryService.getTermForPermission(
      termId,
      workspace.id,
    );
    const ability = await this.spaceAbility.createForUser(
      user,
      existingTerm.spaceId,
    );

    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    await this.dictionaryService.deleteTerm(termId, workspace.id);
  }

  private assertCanImportExportDictionary(user: User) {
    if (!this.isWorkspaceAdmin(user)) {
      throw new ForbiddenException(
        'Only workspace admins can import or export dictionary terms',
      );
    }
  }

  private isWorkspaceAdmin(user: User): boolean {
    return [UserRole.ADMIN, UserRole.OWNER].includes(user.role as UserRole);
  }
}
