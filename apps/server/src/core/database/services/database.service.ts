import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseRepo } from '@docmost/db/repos/database/database.repo';
import { DatabaseRowRepo } from '@docmost/db/repos/database/database-row.repo';
import { DatabaseCellRepo } from '@docmost/db/repos/database/database-cell.repo';
import { DatabasePropertyRepo } from '@docmost/db/repos/database/database-property.repo';
import { DatabaseViewRepo } from '@docmost/db/repos/database/database-view.repo';
import {
  BatchUpdateDatabaseCellsDto,
  CreateDatabaseDto,
  CreateDatabasePropertyDto,
  CreateDatabaseRowDto,
  CreateDatabaseViewDto,
  UpdateDatabaseDto,
  UpdateDatabasePropertyDto,
  UpdateDatabaseViewDto,
} from '../dto/database.dto';

@Injectable()
export class DatabaseService {
  constructor(
    private readonly databaseRepo: DatabaseRepo,
    private readonly databaseRowRepo: DatabaseRowRepo,
    private readonly databaseCellRepo: DatabaseCellRepo,
    private readonly databasePropertyRepo: DatabasePropertyRepo,
    private readonly databaseViewRepo: DatabaseViewRepo,
  ) {}

  /**
   * Проверяет доступ к базе данных в рамках текущего workspace.
   *
   * Если запись не найдена, выбрасывается 404 — это единая точка валидации
   * для всех вложенных ресурсов (properties/rows/cells/views).
   */
  private async getOrFailDatabase(databaseId: string, workspaceId: string) {
    const database = await this.databaseRepo.findById(databaseId, workspaceId);
    if (!database) {
      throw new NotFoundException('Database not found');
    }

    return database;
  }

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
   * Возвращает одну базу данных по ID.
   */
  async getDatabase(databaseId: string, workspaceId: string) {
    return this.getOrFailDatabase(databaseId, workspaceId);
  }

  /**
   * Возвращает список баз данных в пространстве.
   */
  async listBySpace(spaceId: string, workspaceId: string) {
    return this.databaseRepo.findBySpaceId(spaceId, workspaceId);
  }

  /**
   * Обновляет метаданные базы данных.
   */
  async updateDatabase(
    databaseId: string,
    dto: UpdateDatabaseDto,
    actorId: string,
    workspaceId: string,
  ) {
    await this.getOrFailDatabase(databaseId, workspaceId);

    const updated = await this.databaseRepo.updateDatabase(databaseId, workspaceId, {
      ...dto,
      lastUpdatedById: actorId,
    });

    if (!updated) {
      throw new NotFoundException('Database not found');
    }

    return updated;
  }

  /**
   * Выполняет мягкое удаление базы данных.
   */
  async deleteDatabase(databaseId: string, workspaceId: string) {
    await this.getOrFailDatabase(databaseId, workspaceId);
    await this.databaseRepo.softDeleteDatabase(databaseId, workspaceId);
  }

  /**
   * Создаёт свойство (колонку) в базе данных.
   */
  async createProperty(
    databaseId: string,
    dto: CreateDatabasePropertyDto,
    actorId: string,
    workspaceId: string,
  ) {
    await this.getOrFailDatabase(databaseId, workspaceId);

    const currentProperties = await this.databasePropertyRepo.findByDatabaseId(
      databaseId,
    );

    return this.databasePropertyRepo.insertProperty({
      databaseId,
      workspaceId,
      creatorId: actorId,
      name: dto.name,
      type: dto.type,
      settings: (dto.settings as never) ?? null,
      position: currentProperties.length,
    });
  }

  /**
   * Возвращает список свойств базы данных.
   */
  async listProperties(databaseId: string, workspaceId: string) {
    await this.getOrFailDatabase(databaseId, workspaceId);
    return this.databasePropertyRepo.findByDatabaseId(databaseId);
  }

  /**
   * Обновляет свойство базы данных.
   */
  async updateProperty(
    databaseId: string,
    propertyId: string,
    dto: UpdateDatabasePropertyDto,
    workspaceId: string,
  ) {
    await this.getOrFailDatabase(databaseId, workspaceId);

    const property = await this.databasePropertyRepo.findById(propertyId);
    if (!property || property.databaseId !== databaseId) {
      throw new NotFoundException('Database property not found');
    }

    return this.databasePropertyRepo.updateProperty(propertyId, {
      ...dto,
      settings: dto.settings as never,
    });
  }

  /**
   * Мягко удаляет свойство базы данных.
   */
  async deleteProperty(databaseId: string, propertyId: string, workspaceId: string) {
    await this.getOrFailDatabase(databaseId, workspaceId);

    const property = await this.databasePropertyRepo.findById(propertyId);
    if (!property || property.databaseId !== databaseId) {
      throw new NotFoundException('Database property not found');
    }

    await this.databasePropertyRepo.softDeleteProperty(propertyId);
  }

  /**
   * Создаёт строку базы данных.
   */
  async createRow(
    databaseId: string,
    dto: CreateDatabaseRowDto,
    actorId: string,
    workspaceId: string,
  ) {
    await this.getOrFailDatabase(databaseId, workspaceId);

    return this.databaseRowRepo.insertRow({
      databaseId,
      pageId: dto.pageId,
      workspaceId,
      createdById: actorId,
      updatedById: actorId,
    });
  }

  /**
   * Возвращает все строки базы данных.
   */
  async listRows(databaseId: string, workspaceId: string) {
    await this.getOrFailDatabase(databaseId, workspaceId);
    return this.databaseRowRepo.findByDatabaseId(databaseId);
  }

  /**
   * Батч-обновление ячеек в рамках строки (страница является ключом строки).
   */
  async batchUpdateRowCells(
    databaseId: string,
    pageId: string,
    dto: BatchUpdateDatabaseCellsDto,
    actorId: string,
    workspaceId: string,
  ) {
    await this.getOrFailDatabase(databaseId, workspaceId);

    const existingRow = await this.databaseRowRepo.findByDatabaseAndPage(
      databaseId,
      pageId,
    );

    const row =
      existingRow ??
      (await this.databaseRowRepo.insertRow({
        databaseId,
        pageId,
        workspaceId,
        createdById: actorId,
        updatedById: actorId,
      }));

    const cells = [];
    for (const cell of dto.cells) {
      if (cell.operation === 'delete') {
        const deleted = await this.databaseCellRepo.upsertCell({
          databaseId,
          pageId,
          propertyId: cell.propertyId,
          workspaceId,
          value: null,
          attachmentId: null,
          createdById: actorId,
          updatedById: actorId,
        });

        const softDeleted = await this.databaseCellRepo.updateCell(deleted.id, {
          deletedAt: new Date(),
          value: null,
          attachmentId: null,
          updatedById: actorId,
        });

        cells.push(softDeleted);
        continue;
      }

      const upserted = await this.databaseCellRepo.upsertCell({
        databaseId,
        pageId,
        propertyId: cell.propertyId,
        workspaceId,
        value: (cell.value as never) ?? null,
        attachmentId: cell.attachmentId ?? null,
        createdById: actorId,
        updatedById: actorId,
      });

      cells.push(upserted);
    }

    return { row, cells };
  }

  /**
   * Создаёт новое представление базы данных.
   */
  async createView(
    databaseId: string,
    dto: CreateDatabaseViewDto,
    actorId: string,
    workspaceId: string,
  ) {
    await this.getOrFailDatabase(databaseId, workspaceId);

    return this.databaseViewRepo.insertView({
      databaseId,
      workspaceId,
      creatorId: actorId,
      name: dto.name,
      type: dto.type,
      config: (dto.config as never) ?? null,
    });
  }

  /**
   * Возвращает список представлений базы данных.
   */
  async listViews(databaseId: string, workspaceId: string) {
    await this.getOrFailDatabase(databaseId, workspaceId);
    return this.databaseViewRepo.findByDatabaseId(databaseId);
  }

  /**
   * Обновляет представление базы данных.
   */
  async updateView(
    databaseId: string,
    viewId: string,
    dto: UpdateDatabaseViewDto,
    workspaceId: string,
  ) {
    await this.getOrFailDatabase(databaseId, workspaceId);

    const view = await this.databaseViewRepo.findById(viewId);
    if (!view || view.databaseId !== databaseId) {
      throw new NotFoundException('Database view not found');
    }

    return this.databaseViewRepo.updateView(viewId, {
      ...dto,
      config: dto.config as never,
    });
  }

  /**
   * Мягко удаляет представление базы данных.
   */
  async deleteView(databaseId: string, viewId: string, workspaceId: string) {
    await this.getOrFailDatabase(databaseId, workspaceId);

    const view = await this.databaseViewRepo.findById(viewId);
    if (!view || view.databaseId !== databaseId) {
      throw new NotFoundException('Database view not found');
    }

    await this.databaseViewRepo.softDeleteView(viewId);
  }
}
