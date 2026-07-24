import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import {
  FileImportSource,
  FileTaskStatus,
  FileTaskType,
} from '../utils/file.utils';

@Injectable()
export class FileTaskQueryService {
  constructor(
    private readonly spaceMemberRepo: SpaceMemberRepo,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  findForUser(userId: string, pagination: PaginationOptions) {
    const query = this.db
      .selectFrom('fileTasks')
      .selectAll()
      .where(
        'spaceId',
        'in',
        this.spaceMemberRepo.getUserSpaceIdsQuery(userId),
      );

    return executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [{ expression: 'id', direction: 'desc' }],
      parseCursor: (cursor) => ({ id: cursor.id }),
    });
  }

  findById(fileTaskId: string) {
    return this.db
      .selectFrom('fileTasks')
      .selectAll()
      .where('id', '=', fileTaskId)
      .executeTakeFirst();
  }

  findRecentDocmostImports(userId: string, spaceId: string, limit = 5) {
    return this.db
      .selectFrom('fileTasks')
      .selectAll()
      .where('creatorId', '=', userId)
      .where('spaceId', '=', spaceId)
      .where('type', '=', FileTaskType.Import)
      .where('source', '=', FileImportSource.Docmost)
      .where('status', '=', FileTaskStatus.Success)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .execute();
  }
}
