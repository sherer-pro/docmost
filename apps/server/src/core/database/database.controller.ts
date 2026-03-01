import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { DatabaseService } from './services/database.service';
import {
  CreateDatabaseDto,
  ListDatabasesDto,
  UpsertDatabaseRowCellsDto,
} from './dto/database.dto';

@UseGuards(JwtAuthGuard)
@Controller('databases')
export class DatabaseController {
  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Создаёт новую сущность базы данных в рамках пространства.
   */
  @HttpCode(HttpStatus.OK)
  @Post('create')
  async create(
    @Body() dto: CreateDatabaseDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.databaseService.createDatabase(dto, user.id, workspace.id);
  }

  /**
   * Возвращает список баз данных пространства.
   */
  @HttpCode(HttpStatus.OK)
  @Post('list')
  async list(
    @Body() dto: ListDatabasesDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.databaseService.listBySpace(dto.spaceId, workspace.id);
  }

  /**
   * Выполняет upsert значений ячеек для строки базы данных.
   */
  @HttpCode(HttpStatus.OK)
  @Post('rows/upsert-cells')
  async upsertRowCells(
    @Body() dto: UpsertDatabaseRowCellsDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.databaseService.upsertRowCells(dto, user.id, workspace.id);
  }
}
