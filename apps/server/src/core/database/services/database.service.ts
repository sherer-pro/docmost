import { Injectable } from '@nestjs/common';
import { DatabaseRepo } from '@docmost/db/repos/database/database.repo';
import { DatabaseRowRepo } from '@docmost/db/repos/database/database-row.repo';
import { DatabaseCellRepo } from '@docmost/db/repos/database/database-cell.repo';
import {
  CreateDatabaseDto,
  UpsertDatabaseRowCellsDto,
} from '../dto/database.dto';

@Injectable()
export class DatabaseService {
  constructor(
    private readonly databaseRepo: DatabaseRepo,
    private readonly databaseRowRepo: DatabaseRowRepo,
    private readonly databaseCellRepo: DatabaseCellRepo,
  ) {}

  /**
   * Создаёт новую базу данных в указанном workspace/space.
   */
  async createDatabase(
    dto: CreateDatabaseDto,
    actorId: string,
    workspaceId: string,
  ) {
    return this.databaseRepo.insertDatabase({
      ...dto,
      workspaceId,
      creatorId: actorId,
      lastUpdatedById: actorId,
    });
  }

  /**
   * Возвращает список баз данных в пространстве.
   */
  async listBySpace(spaceId: string, workspaceId: string) {
    return this.databaseRepo.findBySpaceId(spaceId, workspaceId);
  }

  /**
   * Создаёт строку базы данных (если её ещё нет) и upsert-ит её ячейки.
   */
  async upsertRowCells(
    dto: UpsertDatabaseRowCellsDto,
    actorId: string,
    workspaceId: string,
  ) {
    const existingRow = await this.databaseRowRepo.findByDatabaseAndPage(
      dto.databaseId,
      dto.pageId,
    );

    const row =
      existingRow ??
      (await this.databaseRowRepo.insertRow({
        databaseId: dto.databaseId,
        pageId: dto.pageId,
        workspaceId,
        createdById: actorId,
        updatedById: actorId,
      }));

    for (const cell of dto.cells) {
      await this.databaseCellRepo.upsertCell({
        databaseId: dto.databaseId,
        pageId: dto.pageId,
        propertyId: cell.propertyId,
        workspaceId,
        value: (cell.value as never) ?? null,
        createdById: actorId,
        updatedById: actorId,
      });
    }

    return row;
  }
}
