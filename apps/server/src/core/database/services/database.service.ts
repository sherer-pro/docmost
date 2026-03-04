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
import { ExportService } from '../../../integrations/export/export.service';
import { InjectKysely } from 'nestjs-kysely';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
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
import type { DatabasePropertyType } from '@docmost/api-contract';
import { QueueJob, QueueName } from '../../../integrations/queue/constants';
import { IPageRecipientNotificationJob } from '../../../integrations/queue/constants/queue.interface';
import { generateSlugId } from '../../../common/helpers';

interface IDatabaseCellValueWithFallback {
  value: unknown;
  rawValueBeforeTypeChange: unknown;
}

interface IDatabaseUserCellValue {
  id: string;
}

/**
 * Extended response contract for updateDatabase:
 * in addition to the database itself, we return the current slug of the linked page,
 * so that the client can synchronously update the URL after the rename.
 */
export interface IUpdatedDatabaseResponse {
  pageSlugId: string | null;
}

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
    private readonly exportService: ExportService,
    private readonly spaceAbility: SpaceAbilityFactory,
    @InjectQueue(QueueName.NOTIFICATION_QUEUE)
    private readonly notificationQueue: Queue,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  /**
   * Legacy type `text` is no longer supported by the contract.
   * For backward compatibility, let's normalize it to `multiline_text`
   * before any read/convert operations.
   */
  private normalizePropertyType(type: string | null | undefined): DatabasePropertyType {
    if (type === 'text') {
      return 'multiline_text';
    }

    return type as DatabasePropertyType;
  }

  /**
   * Casts property types to the actual contract in API responses.
   */
  private normalizeProperties<T extends { type: string | null }>(properties: T[]): T[] {
    return properties.map((property) => ({
      ...property,
      type: this.normalizePropertyType(property.type),
    }));
  }

  /**
   * Checks database access within the current workspace.
   *
   * If the record is not found, a 404 is thrown - this is a single point of validation
   * for all nested resources (properties/rows/cells/views).
   */
  private async getOrFailDatabase(databaseId: string, workspaceId: string) {
    const database = await this.databaseRepo.findById(databaseId, workspaceId);
    if (!database) {
      throw new NotFoundException('Database not found');
    }

    return database;
  }

  /**
   * Escapes a custom value for a markdown table cell.
   */
  private escapeMarkdownCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  }

  /**
   * Converts an arbitrary cell value to a safe string.
   */
  private stringifyCellValue(value: unknown): string {
    const normalizedValue = this.extractCurrentCellValue(value);

    if (normalizedValue === null || typeof normalizedValue === 'undefined') {
      return '';
    }

    if (typeof normalizedValue === 'string') {
      return normalizedValue;
    }

    return JSON.stringify(normalizedValue);
  }

  /**
   * Returns the active value of a cell taking into account the fallback container.
   */
  private extractCurrentCellValue(value: unknown): unknown {
    if (!this.isCellFallbackValue(value)) {
      return value;
    }

    return value.value;
  }

  /**
   * Checks that the value is stored in the fallback container format.
   */
  private isCellFallbackValue(value: unknown): value is IDatabaseCellValueWithFallback {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as Record<string, unknown>;
    return 'value' in candidate && 'rawValueBeforeTypeChange' in candidate;
  }

  /**
   * Returns the original value for the reverse type change script.
   */
  private extractValueForConversion(value: unknown): unknown {
    if (!this.isCellFallbackValue(value)) {
      return value;
    }

    if (value.value === null || typeof value.value === 'undefined') {
      return value.rawValueBeforeTypeChange;
    }

    return value.value;
  }

  /**
   * Determines whether the current type can be automatically cast to the target type.
   */
  private canConvertToType(nextType: DatabasePropertyType): boolean {
    return !['user', 'checkbox', 'page_reference', 'select'].includes(nextType);
  }

  /**
   * Attempts to convert a value to the target property type.
   */
  private convertCellValueByPropertyType(
    value: unknown,
    fromType: DatabasePropertyType,
    toType: DatabasePropertyType,
  ): { converted: unknown; isConvertible: boolean } {
    const normalizedValue = this.extractValueForConversion(value);

    if (normalizedValue === null || typeof normalizedValue === 'undefined') {
      return { converted: null, isConvertible: true };
    }

    if (!this.canConvertToType(toType)) {
      return { converted: normalizedValue, isConvertible: false };
    }

    if (fromType === 'checkbox' && toType === 'multiline_text') {
      if (typeof normalizedValue === 'boolean') {
        return { converted: normalizedValue ? 'Да' : 'Нет', isConvertible: true };
      }

      const booleanValue = String(normalizedValue).toLowerCase() === 'true';
      return { converted: booleanValue ? 'Да' : 'Нет', isConvertible: true };
    }

    if (fromType === 'select' && toType === 'multiline_text') {
      if (typeof normalizedValue === 'string') {
        return { converted: normalizedValue, isConvertible: true };
      }

      if (typeof normalizedValue === 'object') {
        const option = normalizedValue as Record<string, unknown>;
        const optionLabel = option.label;
        const optionValue = option.value;
        if (typeof optionLabel === 'string') {
          return { converted: optionLabel, isConvertible: true };
        }

        if (typeof optionValue === 'string') {
          return { converted: optionValue, isConvertible: true };
        }
      }
    }

    if (value === null || typeof value === 'undefined') {
      return { converted: null, isConvertible: true };
    }

    if (toType === 'multiline_text' || toType === 'code') {
      if (typeof normalizedValue === 'string') {
        return { converted: normalizedValue, isConvertible: true };
      }

      return { converted: JSON.stringify(normalizedValue), isConvertible: true };
    }

    return { converted: normalizedValue, isConvertible: true };
  }

  /**
   * Converts property cell values when changing type.
   */
  private async convertPropertyCellValues(
    databaseId: string,
    propertyId: string,
    fromType: DatabasePropertyType,
    toType: DatabasePropertyType,
    workspaceId: string,
    spaceId: string,
  ): Promise<void> {
    const rows = await this.databaseRowRepo.findByDatabaseId(databaseId, workspaceId, spaceId);

    for (const row of rows) {
      const cells = await this.databaseCellRepo.findByDatabaseAndPage(databaseId, row.pageId);
      const targetCell = cells.find((cell) => cell.propertyId === propertyId);

      if (!targetCell) {
        continue;
      }

      const { converted, isConvertible } = this.convertCellValueByPropertyType(
        targetCell.value,
        fromType,
        toType,
      );

      const nextValue = isConvertible
        ? converted
        : {
            value: null,
            rawValueBeforeTypeChange: this.extractCurrentCellValue(targetCell.value),
          };

      await this.databaseCellRepo.updateCell(targetCell.id, {
        value: nextValue as never,
      });
    }
  }

  /**
   * Collects a markdown representation of the current database table.
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
      const valueByPropertyId = new Map<string, string>(
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
   * Generates a minimal valid PDF document with text content.
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
   * Exports the database to markdown or pdf.
   */
  async exportDatabase(
    databaseId: string,
    format: DatabaseExportFormat,
    user: User,
    workspaceId: string,
  ) {
    const database = await this.getOrFailDatabase(databaseId, workspaceId);
    await this.assertCanReadDatabasePages(user, database.spaceId);
    const safeName = (database.name?.trim() || 'database').replace(/\s+/g, '-').toLowerCase();

    if (format === DatabaseExportFormat.PDF) {
      const markdown = await this.buildDatabaseMarkdown(databaseId, user, workspaceId);
      return {
        contentType: 'application/pdf',
        fileName: `${safeName}.pdf`,
        fileBuffer: this.createSimplePdfBuffer(markdown),
      };
    }

    if (!database.pageId) {
      throw new NotFoundException('Database root page not found');
    }

    /**
     * For markdown export we use the standard Docmost mechanism for pages:
     * - a zip archive is generated,
     * - child pages (base rows) are included,
     * - docmost-metadata.json is automatically added.
     */
    const zipFileStream = await this.exportService.exportPages(
      database.pageId,
      DatabaseExportFormat.Markdown,
      false,
      true,
    );

    return {
      contentType: 'application/zip',
      fileName: `${safeName}.zip`,
      fileStream: zipFileStream,
    };
  }

  /**
   * Checks the user's right to read pages in the database space.
   */
  private async assertCanReadDatabasePages(user: User, spaceId: string) {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }
  }

  /**
   * Checks the user's right to modify pages in the database space.
   */
  private async assertCanManageDatabasePages(user: User, spaceId: string) {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }
  }

  /**
   * Validates the target page of a row within the workspace/space and excludes removed pages.
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
   * Creates a new database in the specified workspace/space.
   */
  async createDatabase(
    dto: CreateDatabaseDto,
    actorId: string,
    workspaceId: string,
  ) {
    const normalizedName = dto.name?.trim() || 'Untitled database';

    /**
     * Create an “anchor” database page.
     *
     * This page stores the canonical position and parent in a single tree,
     * therefore sidebar and DnD work according to the same rules as for regular pages.
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
      descriptionContent: dto.descriptionContent as never,
      icon: dto.icon,
      workspaceId,
      creatorId: actorId,
      lastUpdatedById: actorId,
      pageId: databasePage.id,
    });
  }

  /**
   * Returns one database by ID.
   */
  async getDatabase(databaseId: string, workspaceId: string) {
    return this.getOrFailDatabase(databaseId, workspaceId);
  }

  /**
   * Returns a list of databases in the space.
   */
  async listBySpace(spaceId: string, workspaceId: string) {
    return this.databaseRepo.findBySpaceId(spaceId, workspaceId);
  }

  /**
   * Updates database metadata.
   */
  async updateDatabase(
    databaseId: string,
    dto: UpdateDatabaseDto,
    actorId: string,
    workspaceId: string,
  ): Promise<Awaited<ReturnType<DatabaseRepo['updateDatabase']>> & IUpdatedDatabaseResponse> {
    const database = await this.getOrFailDatabase(databaseId, workspaceId);
    const hasNameChanged = typeof dto.name === 'string' && dto.name !== database.name;

    const updated = await this.databaseRepo.updateDatabase(databaseId, workspaceId, {
      ...dto,
      descriptionContent: dto.descriptionContent as never,
      lastUpdatedById: actorId,
    });

    if (!updated) {
      throw new NotFoundException('Database not found');
    }

    let pageSlugId: string | null = null;

    /**
     * For database pages, keep the title/slug in pages synchronized with the database name.
     * This guarantees the correct canonical URL immediately after the rename.
     */
    if (database.pageId && hasNameChanged) {
      pageSlugId = generateSlugId();

      await this.pageRepo.updatePage(
        {
          title: updated.name,
          slugId: pageSlugId,
          lastUpdatedById: actorId,
          workspaceId,
        },
        database.pageId,
      );
    }

    return {
      ...updated,
      pageSlugId,
    };
  }

  /**
   * Performs a soft delete of the database.
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
   * Creates a property (column) in the database.
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
   * Returns a list of database properties.
   */
  async listProperties(databaseId: string, workspaceId: string) {
    await this.getOrFailDatabase(databaseId, workspaceId);
    const properties = await this.databasePropertyRepo.findByDatabaseId(databaseId);
    return this.normalizeProperties(properties);
  }

  /**
   * Updates a database property.
   */
  async updateProperty(
    databaseId: string,
    propertyId: string,
    dto: UpdateDatabasePropertyDto,
    workspaceId: string,
  ) {
    const database = await this.getOrFailDatabase(databaseId, workspaceId);

    const property = await this.databasePropertyRepo.findById(propertyId);
    if (!property || property.databaseId !== databaseId) {
      throw new NotFoundException('Database property not found');
    }

    const updatedProperty = await this.databasePropertyRepo.updateProperty(propertyId, {
      ...dto,
      settings: dto.settings as never,
    });

    if (dto.type && dto.type !== property.type) {
      await this.convertPropertyCellValues(
        databaseId,
        propertyId,
        this.normalizePropertyType(property.type),
        dto.type,
        workspaceId,
        database.spaceId,
      );
    }

    return updatedProperty;
  }

  /**
   * Softly deletes a database property.
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
   * Creates a database row.
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
     * Calculate the parent of the new line:
     * - if the client explicitly passed parentPageId, use it;
     * - otherwise we bind the string to the database page as to the root node of the string tree.
     */
    const targetParentPageId = dto.parentPageId ?? database.pageId ?? null;

    if (!database.pageId) {
      throw new NotFoundException('Database root page not found');
    }

    /**
     * If the parent is specified, we check the basic accessibility of the page in the desired workspace/space.
     */
    if (targetParentPageId) {
      await this.assertCanAccessTargetPage(
        targetParentPageId,
        workspaceId,
        database.spaceId,
      );
    }

    /**
     * Additional database context protection:
     * We only allow line nesting in:
     * 1) the page of the database itself, or
     * 2) a page of an already existing (non-archived) line of the same database.
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
     * The base line is created as a regular page in the same tree.
     *
     * By default, we attach a string to the pageId of the base so that the structure remains
     * predictable and did not fall apart into “orphaned” root pages.
     */
    const page = await this.pageService.create(user.id, workspaceId, {
      title: dto.title,
      icon: dto.icon,
      parentPageId: targetParentPageId,
      spaceId: database.spaceId,
    });

    const createdRow = await this.databaseRowRepo.insertRow({
      databaseId,
      pageId: page.id,
      workspaceId,
      createdById: user.id,
      updatedById: user.id,
    });

    return {
      ...createdRow,
      slugId: page.slugId,
    };
  }

  /**
   * Returns all rows in the database.
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

    for (const descendantPageId of descendantPageIds) {
      await this.databaseRowRepo.softDetachRowLink(
        databaseId,
        descendantPageId,
        workspaceId,
      );
    }

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

    return { database, row, properties: this.normalizeProperties(properties), cells };
  }

  /**
   * Batch update of cells within a row (page is the row key).
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

    const [existingCells, properties] = await Promise.all([
      this.databaseCellRepo.findByDatabaseAndPage(databaseId, pageId),
      this.databasePropertyRepo.findByDatabaseId(databaseId),
    ]);

    const normalizedProperties = this.normalizeProperties(properties);

    const previousCellsByPropertyId = new Map(
      existingCells.map((existingCell) => [existingCell.propertyId, existingCell]),
    );
    const propertyById = new Map(
      normalizedProperties.map((property) => [property.id, property]),
    );

    const cells = [];
    for (const cell of dto.cells) {
      const property = propertyById.get(cell.propertyId);
      const previousCell = previousCellsByPropertyId.get(cell.propertyId);
      const previousUserId =
        property?.type === 'user' ? this.extractUserIdFromCellValue(previousCell?.value) : null;

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

      const normalizedValue = this.normalizeInputCellValue(cell.value);
      const upserted = await this.databaseCellRepo.upsertCell({
        databaseId,
        pageId,
        propertyId: cell.propertyId,
        workspaceId,
        value: normalizedValue as never,
        attachmentId: cell.attachmentId ?? null,
        createdById: user.id,
        updatedById: user.id,
      });

      if (property?.type === 'user') {
        const nextUserId = this.extractUserIdFromCellValue(normalizedValue);

        if (nextUserId && nextUserId !== previousUserId && nextUserId !== user.id) {
          await this.notifyDatabaseUserAssignment({
            actorId: user.id,
            pageId,
            spaceId: database.spaceId,
            workspaceId,
            recipientId: nextUserId,
          });
        }
      }

      previousCellsByPropertyId.set(cell.propertyId, upserted);
      cells.push(upserted);
    }

    return { row, cells };
  }

  /**
   * Retrieves the user ID from the value of the user cell.
   */
  private extractUserIdFromCellValue(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }

    if (!value || typeof value !== 'object' || !('id' in value)) {
      return null;
    }

    const candidate = (value as IDatabaseUserCellValue).id;
    return typeof candidate === 'string' && candidate.trim() ? candidate : null;
  }

  /**
   * Notifies the new executor when the user cell changes.
   */
  private async notifyDatabaseUserAssignment(params: {
    actorId: string;
    pageId: string;
    spaceId: string;
    workspaceId: string;
    recipientId: string;
  }): Promise<void> {
    await this.notificationQueue.add(QueueJob.PAGE_RECIPIENT_NOTIFICATION, {
      reason: 'database-user-assigned',
      actorId: params.actorId,
      pageId: params.pageId,
      spaceId: params.spaceId,
      workspaceId: params.workspaceId,
      candidateUserIds: [params.recipientId],
    } as IPageRecipientNotificationJob);
  }

  /**
   * On the first valid user input, clears the fallback value.
   */
  private normalizeInputCellValue(value: unknown): unknown {
    if (!this.isCellFallbackValue(value)) {
      return value ?? null;
    }

    return value.value ?? null;
  }

  /**
   * Creates a new database view.
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
   * Returns a list of database views.
   */
  async listViews(databaseId: string, workspaceId: string) {
    await this.getOrFailDatabase(databaseId, workspaceId);
    return this.databaseViewRepo.findByDatabaseId(databaseId);
  }

  /**
   * Updates the database view.
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
   * Gently deletes a database view.
   */
  async deleteView(databaseId: string, viewId: string, workspaceId: string) {
    await this.getOrFailDatabase(databaseId, workspaceId);

    const view = await this.databaseViewRepo.findById(viewId);
    if (!view || view.databaseId !== databaseId) {
      throw new NotFoundException('Database view not found');
    }

    await this.databaseViewRepo.softDeleteView(viewId);
  }

  /**
   * Converts the database back to a regular page.
   *
   * Transactionally mark the database entity as deleted (deactivated),
   * archive rows and clear table metadata.
   * The row pages themselves are not deleted and remain child nodes of the root-page.
   */
  async convertDatabaseToPage(
    databaseId: string,
    user: User,
    workspaceId: string,
  ) {
    const database = await this.getOrFailDatabase(databaseId, workspaceId);
    await this.assertCanManageDatabasePages(user, database.spaceId);

   const updatedAt = new Date();

    await executeTx(this.db, async (trx) => {
      await this.databaseRowRepo.archiveByDatabaseId(database.id, workspaceId, trx);
      await this.databaseViewRepo.softDeleteByDatabaseId(database.id, workspaceId, trx);

      await trx
        .updateTable('databaseProperties')
        .set({ deletedAt: updatedAt, updatedAt })
        .where('databaseId', '=', database.id)
        .where('workspaceId', '=', workspaceId)
        .where('deletedAt', 'is', null)
        .execute();

      await this.databaseRepo.updateDatabase(
        database.id,
        workspaceId,
        {
          deletedAt: updatedAt,
          lastUpdatedById: user.id,
        },
        trx,
      );
    });

    if (database.pageId) {
      const page = await this.pageRepo.findById(database.pageId);
      if (page) {
        return page;
      }
    }

    return null;
  }
}
