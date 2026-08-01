import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';

@Injectable()
export class PublicSharingPolicyService {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async isAllowed(
    workspaceId: string,
    spaceId: string,
    trx?: KyselyTransaction,
  ): Promise<boolean> {
    const result = await (trx ?? this.db)
      .selectFrom('workspaces')
      .innerJoin('spaces', 'spaces.workspaceId', 'workspaces.id')
      .select([
        'workspaces.settings as workspaceSettings',
        'spaces.settings as spaceSettings',
      ])
      .where('workspaces.id', '=', workspaceId)
      .where('spaces.id', '=', spaceId)
      .executeTakeFirst();

    return result
      ? this.isAllowedBySettings(
          result.workspaceSettings,
          result.spaceSettings,
        )
      : false;
  }

  isAllowedBySettings(
    workspaceSettings: unknown,
    spaceSettings: unknown,
  ): boolean {
    const workspaceDisabled =
      (workspaceSettings as any)?.sharing?.disabled === true;
    const spaceDisabled = (spaceSettings as any)?.sharing?.disabled === true;
    return !workspaceDisabled && !spaceDisabled;
  }
}
