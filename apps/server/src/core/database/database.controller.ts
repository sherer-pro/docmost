import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { DatabaseService } from './services/database.service';
import {
  BatchUpdateDatabaseCellsDto,
  CreateDatabaseDto,
  CreateDatabasePropertyDto,
  CreateDatabaseRowDto,
  UpdateDatabaseRowDto,
  CreateDatabaseViewDto,
  ListDatabasesQueryDto,
  UpdateDatabaseDto,
  UpdateDatabasePropertyDto,
  UpdateDatabaseViewDto,
  DatabaseRowPageIdDto,
  ExportDatabaseDto,
} from './dto/database.dto';
import { FastifyReply } from 'fastify';

@UseGuards(JwtAuthGuard)
@Controller('databases')
export class DatabaseController {
  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Creates a database.
   */
  @HttpCode(HttpStatus.OK)
  @Post()
  async create(
    @Body() dto: CreateDatabaseDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.databaseService.createDatabase(dto, user.id, workspace.id);
  }

  /**
   * Returns a list of databases by spaceId.
   */
  @Get()
  async list(
    @Query() query: ListDatabasesQueryDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.databaseService.listBySpace(query.spaceId, workspace.id);
  }

  /**
   * Returns one database.
   */
  @Get(':databaseId')
  async getOne(
    @Param('databaseId', ParseUUIDPipe) databaseId: string,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.databaseService.getDatabase(databaseId, workspace.id);
  }

  /**
   * Updates the database.
   */
  @Patch(':databaseId')
  async update(
    @Param('databaseId', ParseUUIDPipe) databaseId: string,
    @Body() dto: UpdateDatabaseDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.databaseService.updateDatabase(
      databaseId,
      dto,
      user.id,
      workspace.id,
    );
  }

  /**
   * Deletes a database (soft delete).
   */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':databaseId')
  async remove(
    @Param('databaseId', ParseUUIDPipe) databaseId: string,
    @AuthWorkspace() workspace: Workspace,
  ) {
    await this.databaseService.deleteDatabase(databaseId, workspace.id);
  }


  /**
   * Converts the database back to a regular page.
   */
  @HttpCode(HttpStatus.OK)
  @Post(':databaseId/convert-to-page')
  async convertToPage(
    @Param('databaseId', ParseUUIDPipe) databaseId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.databaseService.convertDatabaseToPage(
      databaseId,
      user,
      workspace.id,
    );
  }

  /**
   * Creates a new database property.
   */
  @Post(':databaseId/properties')
  async createProperty(
    @Param('databaseId', ParseUUIDPipe) databaseId: string,
    @Body() dto: CreateDatabasePropertyDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.databaseService.createProperty(
      databaseId,
      dto,
      user.id,
      workspace.id,
    );
  }

  /**
   * Returns a list of database properties.
   */
  @Get(':databaseId/properties')
  async listProperties(
    @Param('databaseId', ParseUUIDPipe) databaseId: string,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.databaseService.listProperties(databaseId, workspace.id);
  }

  /**
   * Updates a database property.
   */
  @Patch(':databaseId/properties/:propertyId')
  async updateProperty(
    @Param('databaseId', ParseUUIDPipe) databaseId: string,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdateDatabasePropertyDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.databaseService.updateProperty(
      databaseId,
      propertyId,
      dto,
      workspace.id,
      user.id,
    );
  }

  /**
   * Deletes a database property (soft delete).
   */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':databaseId/properties/:propertyId')
  async removeProperty(
    @Param('databaseId', ParseUUIDPipe) databaseId: string,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    await this.databaseService.deleteProperty(
      databaseId,
      propertyId,
      workspace.id,
      user.id,
    );
  }

  /**
   * Creates a row in the database.
   */
  @Post(':databaseId/rows')
  async createRow(
    @Param('databaseId', ParseUUIDPipe) databaseId: string,
    @Body() dto: CreateDatabaseRowDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.databaseService.createRow(databaseId, dto, user, workspace.id);
  }

  /**
   * Returns a list of database rows.
   */
  @Get(':databaseId/rows')
  async listRows(
    @Param('databaseId', ParseUUIDPipe) databaseId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.databaseService.listRows(databaseId, user, workspace.id);
  }

  /**
   * Renames a database row page and regenerates row slug.
   */
  @Patch(':databaseId/rows/:pageId')
  async updateRow(
    @Param('databaseId', ParseUUIDPipe) databaseId: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body() dto: UpdateDatabaseRowDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.databaseService.updateRow(
      databaseId,
      pageId,
      dto,
      user,
      workspace.id,
    );
  }


  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':databaseId/rows/:pageId')
  async removeRow(
    @Param('databaseId', ParseUUIDPipe) databaseId: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    await this.databaseService.deleteRow(databaseId, pageId, user, workspace.id);
  }


  @Get('rows/:pageId/context')
  async getRowContextByPage(
    @Param() dto: DatabaseRowPageIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.databaseService.getRowContextByPage(dto.pageId, user, workspace.id);
  }

  /**
   * Performs a batch update of cells for a row.
   */
  @Patch(':databaseId/rows/:pageId/cells')
  async batchUpdateRowCells(
    @Param('databaseId', ParseUUIDPipe) databaseId: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body() dto: BatchUpdateDatabaseCellsDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.databaseService.batchUpdateRowCells(
      databaseId,
      pageId,
      dto,
      user,
      workspace.id,
    );
  }



  /**
   * Returns a markdown representation of the database table.
   */
  @Get(':databaseId/markdown')
  async getMarkdown(
    @Param('databaseId', ParseUUIDPipe) databaseId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return {
      markdown: await this.databaseService.buildDatabaseMarkdown(
        databaseId,
        user,
        workspace.id,
      ),
    };
  }

  /**
   * Exports the database to a file.
   */
  @HttpCode(HttpStatus.OK)
  @Post(':databaseId/export')
  async exportDatabase(
    @Param('databaseId', ParseUUIDPipe) databaseId: string,
    @Body() dto: ExportDatabaseDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Res() res: FastifyReply,
  ) {
    const exported = await this.databaseService.exportDatabase(
      databaseId,
      dto.format,
      user,
      workspace.id,
    );

    res.headers({
      'Content-Type': exported.contentType,
      'Content-Disposition':
        'attachment; filename="' + encodeURIComponent(exported.fileName) + '"',
    });

    res.send(exported.fileBuffer ?? exported.fileStream);
  }
  /**
   * Creates a database view.
   */
  @Post(':databaseId/views')
  async createView(
    @Param('databaseId', ParseUUIDPipe) databaseId: string,
    @Body() dto: CreateDatabaseViewDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.databaseService.createView(databaseId, dto, user.id, workspace.id);
  }

  /**
   * Returns a list of database views.
   */
  @Get(':databaseId/views')
  async listViews(
    @Param('databaseId', ParseUUIDPipe) databaseId: string,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.databaseService.listViews(databaseId, workspace.id);
  }

  /**
   * Updates the database view.
   */
  @Patch(':databaseId/views/:viewId')
  async updateView(
    @Param('databaseId', ParseUUIDPipe) databaseId: string,
    @Param('viewId', ParseUUIDPipe) viewId: string,
    @Body() dto: UpdateDatabaseViewDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.databaseService.updateView(databaseId, viewId, dto, workspace.id);
  }

  /**
   * Deletes a database view (soft delete).
   */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':databaseId/views/:viewId')
  async removeView(
    @Param('databaseId', ParseUUIDPipe) databaseId: string,
    @Param('viewId', ParseUUIDPipe) viewId: string,
    @AuthWorkspace() workspace: Workspace,
  ) {
    await this.databaseService.deleteView(databaseId, viewId, workspace.id);
  }
}
