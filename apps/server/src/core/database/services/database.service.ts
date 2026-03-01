import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseRepo } from '@docmost/db/repos/database/database.repo';
import { DatabaseRowRepo } from '@docmost/db/repos/database/database-row.repo';
import { DatabaseCellRepo } from '@docmost/db/repos/database/database-cell.repo';
import { DatabasePropertyRepo } from '@docmost/db/repos/database/database-property.repo';
import { DatabaseViewRepo } from '@docmost/db/repos/database/database-view.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { User } from '@docmost/db/types/entity.types';
import { PageService } from '../../page/services/page.service';
import SpaceAbilityFactory from '../../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../casl/interfaces/space-ability.type';
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
    private readonly pageRepo: PageRepo,
    private readonly pageService: PageService,
    private readonly spaceAbility: SpaceAbilityFactory,
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
   * Проверяет право пользователя на чтение страниц в пространстве базы данных.
   */
  private async assertCanReadDatabasePages(user: User, spaceId: string) {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }
  }

  /**
   * Проверяет право пользователя на изменение страниц в пространстве базы данных.
   */
  private async assertCanManageDatabasePages(user: User, spaceId: string) {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }
  }

  /**
   * Валидирует целевую страницу строки в пределах workspace/space и исключает удалённые страницы.
   */
  private async assertCanAccessTargetPage(
    pageId: string,
    workspaceId: string,
    spaceId: string,
  ) {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.workspaceId !== workspaceId || page.spaceId !== spaceId) {
      throw new NotFoundException('Page not found');
    }

    if (page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
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
    await this.databaseCellRepo.softDeleteByDatabaseId(databaseId, workspaceId);
    await this.databaseViewRepo.softDeleteByDatabaseId(databaseId, workspaceId);
    await this.databaseRowRepo.archiveByDatabaseId(databaseId, workspaceId);
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
    user: User,
    workspaceId: string,
  ) {
    const database = await this.getOrFailDatabase(databaseId, workspaceId);
    await this.assertCanManageDatabasePages(user, database.spaceId);

    const page = await this.pageService.create(user.id, workspaceId, {
      title: dto.title,
      icon: dto.icon,
      parentPageId: null,
      spaceId: database.spaceId,
    });

    return this.databaseRowRepo.insertRow({
      databaseId,
      pageId: page.id,
      workspaceId,
      createdById: user.id,
      updatedById: user.id,
    });
  }

  /**
   * Возвращает все строки базы данных.
   */
  async listRows(databaseId: string, user: User, workspaceId: string) {
    const database = await this.getOrFailDatabase(databaseId, workspaceId);
    await this.assertCanReadDatabasePages(user, database.spaceId);

    return this.databaseRowRepo.findByDatabaseId(
      databaseId,
      workspaceId,
      database.spaceId,
    );
  }


  async deleteRow(
    databaseId: string,
    pageId: string,
    user: User,
    workspaceId: string,
  ) {
    const database = await this.getOrFailDatabase(databaseId, workspaceId);
    await this.assertCanManageDatabasePages(user, database.spaceId);

    const row = await this.databaseRowRepo.findByDatabaseAndPage(databaseId, pageId);
    if (!row || row.archivedAt) {
      throw new NotFoundException('Database row not found');
    }

    const pages = await this.pageRepo.getPageAndDescendants(pageId, {
      includeContent: false,
    });

    const descendantPageIds = pages.map((page) => page.id);

    await this.databaseRowRepo.archiveByPageIds(
      databaseId,
      workspaceId,
      descendantPageIds,
    );

    await this.pageRepo.removePage(pageId, user.id, workspaceId);
  }


  async getRowContextByPage(pageId: string, user: User, workspaceId: string) {
    const row = await this.databaseRowRepo.findActiveByPageId(pageId, workspaceId);

    if (!row) {
      return null;
    }

    const database = await this.getOrFailDatabase(row.databaseId, workspaceId);
    await this.assertCanReadDatabasePages(user, database.spaceId);

    const [properties, cells] = await Promise.all([
      this.databasePropertyRepo.findByDatabaseId(database.id),
      this.databaseCellRepo.findByDatabaseAndPage(database.id, pageId),
    ]);

    return { database, row, properties, cells };
  }

  /**
   * Батч-обновление ячеек в рамках строки (страница является ключом строки).
   */
  async batchUpdateRowCells(
    databaseId: string,
    pageId: string,
    dto: BatchUpdateDatabaseCellsDto,
    user: User,
    workspaceId: string,
  ) {
    const database = await this.getOrFailDatabase(databaseId, workspaceId);
    await this.assertCanManageDatabasePages(user, database.spaceId);
    await this.assertCanAccessTargetPage(pageId, workspaceId, database.spaceId);

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
        createdById: user.id,
        updatedById: user.id,
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
          createdById: user.id,
          updatedById: user.id,
        });

        const softDeleted = await this.databaseCellRepo.updateCell(deleted.id, {
          deletedAt: new Date(),
          value: null,
          attachmentId: null,
          updatedById: user.id,
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
        createdById: user.id,
        updatedById: user.id,
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
