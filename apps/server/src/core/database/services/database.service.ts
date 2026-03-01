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
  DatabaseExportFormat,
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
   * Экранирует пользовательское значение для markdown-ячейки таблицы.
   */
  private escapeMarkdownCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  }

  /**
   * Преобразует произвольное значение ячейки в безопасную строку.
   */
  private stringifyCellValue(value: unknown): string {
    if (value === null || typeof value === 'undefined') {
      return '';
    }

    if (typeof value === 'string') {
      return value;
    }

    return JSON.stringify(value);
  }

  /**
   * Собирает markdown-представление текущей таблицы базы данных.
   */
  async buildDatabaseMarkdown(databaseId: string, user: User, workspaceId: string) {
    const database = await this.getOrFailDatabase(databaseId, workspaceId);
    await this.assertCanReadDatabasePages(user, database.spaceId);

    const [properties, rows] = await Promise.all([
      this.databasePropertyRepo.findByDatabaseId(databaseId),
      this.databaseRowRepo.findByDatabaseId(databaseId, workspaceId, database.spaceId),
    ]);

    const title = database.name?.trim() || 'Database';
    const header = ['Title', ...properties.map((property) => property.name || 'Column')];
    const separator = header.map(() => '---');

    const tableRows = rows.map((row) => {
      const titleCell = row.page?.title || row.pageTitle || '';
      const valueByPropertyId = new Map(
        (row.cells ?? []).map((cell) => [cell.propertyId, this.stringifyCellValue(cell.value)]),
      );

      return [
        this.escapeMarkdownCell(titleCell),
        ...properties.map((property) =>
          this.escapeMarkdownCell(valueByPropertyId.get(property.id) ?? ''),
        ),
      ];
    });

    const table = [header, separator, ...tableRows]
      .map((line) => `| ${line.join(' | ')} |`)
      .join('\n');

    return `# ${title}\n\n${table}`;
  }

  /**
   * Формирует минимальный валидный PDF-документ с текстовым содержимым.
   */
  private createSimplePdfBuffer(content: string): Buffer {
    const escapePdfText = (value: string) =>
      value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

    const textLines = content
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .slice(0, 80);

    const textCommands = textLines
      .map((line, index) => `1 0 0 1 50 ${770 - index * 14} Tm (${escapePdfText(line)}) Tj`)
      .join('\n');

    const stream = `BT\n/F1 10 Tf\n${textCommands}\nET`;
    const streamLength = Buffer.byteLength(stream, 'utf8');

    const objects = [
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
      `4 0 obj << /Length ${streamLength} >> stream\n${stream}\nendstream endobj`,
      '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    ];

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [0];

    for (const object of objects) {
      offsets.push(Buffer.byteLength(pdf, 'utf8'));
      pdf += `${object}\n`;
    }

    const xrefOffset = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i <= objects.length; i += 1) {
      pdf += `${offsets[i].toString().padStart(10, '0')} 00000 n \n`;
    }

    pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\n`;
    pdf += `startxref\n${xrefOffset}\n%%EOF`;

    return Buffer.from(pdf, 'utf8');
  }

  /**
   * Экспортирует базу в markdown или pdf.
   */
  async exportDatabase(
    databaseId: string,
    format: DatabaseExportFormat,
    user: User,
    workspaceId: string,
  ) {
    const markdown = await this.buildDatabaseMarkdown(databaseId, user, workspaceId);
    const database = await this.getOrFailDatabase(databaseId, workspaceId);
    const safeName = (database.name?.trim() || 'database').replace(/\s+/g, '-').toLowerCase();

    if (format === DatabaseExportFormat.PDF) {
      return {
        contentType: 'application/pdf',
        fileName: `${safeName}.pdf`,
        fileBuffer: this.createSimplePdfBuffer(markdown),
      };
    }

    return {
      contentType: 'text/markdown; charset=utf-8',
      fileName: `${safeName}.md`,
      fileBuffer: Buffer.from(markdown, 'utf8'),
    };
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
    const normalizedName = dto.name?.trim() || 'Untitled database';

    /**
     * Создаём «якорную» страницу базы данных.
     *
     * Эта страница хранит каноническую позицию и родителя в едином дереве,
     * поэтому sidebar и DnD работают по тем же правилам, что и для обычных страниц.
     */
    const databasePage = await this.pageService.create(actorId, workspaceId, {
      title: normalizedName,
      icon: dto.icon,
      parentPageId: dto.parentPageId ?? null,
      spaceId: dto.spaceId,
    });

    return this.databaseRepo.insertDatabase({
      spaceId: dto.spaceId,
      name: normalizedName,
      description: dto.description,
      icon: dto.icon,
      workspaceId,
      creatorId: actorId,
      lastUpdatedById: actorId,
      pageId: databasePage.id,
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
    const database = await this.getOrFailDatabase(databaseId, workspaceId);

    await this.databaseCellRepo.softDeleteByDatabaseId(databaseId, workspaceId);
    await this.databaseViewRepo.softDeleteByDatabaseId(databaseId, workspaceId);

    if (database.pageId) {
      const pages = await this.pageRepo.getPageAndDescendants(database.pageId, {
        includeContent: false,
      });

      await this.databaseRowRepo.archiveByPageIds(
        databaseId,
        workspaceId,
        pages.map((page) => page.id),
      );

      await this.pageRepo.removePage(
        database.pageId,
        database.lastUpdatedById ?? database.creatorId,
        workspaceId,
      );
    } else {
      await this.databaseRowRepo.archiveByDatabaseId(databaseId, workspaceId);
    }

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

    /**
     * Вычисляем родителя новой строки:
     * - если клиент явно передал parentPageId, используем его;
     * - иначе привязываем строку к странице базы данных как к корневому узлу дерева строк.
     */
    const targetParentPageId = dto.parentPageId ?? database.pageId ?? null;

    if (!database.pageId) {
      throw new NotFoundException('Database root page not found');
    }

    /**
     * Если родитель указан, проверяем базовую доступность страницы в нужном workspace/space.
     */
    if (targetParentPageId) {
      await this.assertCanAccessTargetPage(
        targetParentPageId,
        workspaceId,
        database.spaceId,
      );
    }

    /**
     * Дополнительная защита контекста базы данных:
     * разрешаем вложенность строки только в:
     * 1) страницу самой базы, либо
     * 2) страницу уже существующей (неархивной) строки этой же базы.
     */
    if (targetParentPageId && targetParentPageId !== database.pageId) {
      const parentRow = await this.databaseRowRepo.findByDatabaseAndPage(
        databaseId,
        targetParentPageId,
      );

      if (!parentRow || parentRow.archivedAt) {
        throw new NotFoundException('Parent row not found');
      }
    }

    /**
     * Строка базы создаётся как обычная страница в том же дереве.
     *
     * По умолчанию прикрепляем строку к pageId базы, чтобы структура оставалась
     * предсказуемой и не разваливалась на «осиротевшие» корневые страницы.
     */
    const page = await this.pageService.create(user.id, workspaceId, {
      title: dto.title,
      icon: dto.icon,
      parentPageId: targetParentPageId,
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

    await this.assertCanAccessTargetPage(pageId, workspaceId, database.spaceId);

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
