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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import { DictionaryService } from './dictionary.service';
import {
  CreateDictionaryTermDto,
  ListDictionaryTermsQueryDto,
  UpdateDictionaryTermDto,
} from './dto/dictionary-term.dto';

@UseGuards(JwtAuthGuard)
@Controller('dictionary-terms')
export class DictionaryController {
  constructor(
    private readonly dictionaryService: DictionaryService,
    private readonly spaceAbility: SpaceAbilityFactory,
  ) {}

  @Get()
  async list(
    @Query() query: ListDictionaryTermsQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = await this.spaceAbility.createForUser(
      user,
      query.spaceId,
    );

    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    return this.dictionaryService.listTerms(query.spaceId, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
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
}
