import { ConflictException, Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import type {
  KyselyDB,
  KyselyTransaction,
} from '@docmost/db/types/kysely.types';
import { StorageService } from '../../integrations/storage/storage.service';
import {
  attachmentFileVersion,
  attachmentMetadataVersion,
} from '../../common/helpers/attachment-file-version';

export type DrawioSource = {
  attachmentId: string;
  attachmentVersion: string;
  pageId: string;
  spaceId: string;
  workspaceId: string;
};

@Injectable()
export class DrawioSourceService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly storage: StorageService,
  ) {}

  async check(source: DrawioSource, trx?: KyselyTransaction) {
    const row = await (trx ?? this.db)
      .selectFrom('attachments')
      .selectAll()
      .where('id', '=', source.attachmentId)
      .where('pageId', '=', source.pageId)
      .where('spaceId', '=', source.spaceId)
      .where('workspaceId', '=', source.workspaceId)
      .where('fileExt', '=', '.svg')
      .where('deletedAt', 'is', null)
      .$if(Boolean(trx), (q) => q.forShare())
      .executeTakeFirst();
    if (row) {
      const object = await this.storage.readVersionedRange(row.filePath, 0, 1);
      if (
        attachmentFileVersion(
          attachmentMetadataVersion(row),
          object.version,
        ) === source.attachmentVersion
      )
        return;
    }
    throw new ConflictException({
      code: 'MCP_SOURCE_CHANGED',
      message: 'The active Draw.io attachment changed. Read it again.',
    });
  }

  withCurrentSource(source: DrawioSource, mutate: () => Promise<void>) {
    return this.db.transaction().execute(async (trx) => {
      await this.check(source, trx);
      await mutate();
    });
  }
}
