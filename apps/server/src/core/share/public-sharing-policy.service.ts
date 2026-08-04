import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { SpacePolicyService } from '../space-policy/space-policy.service';

@Injectable()
export class PublicSharingPolicyService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly spacePolicy: SpacePolicyService,
  ) {}

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
    return !this.spacePolicy.getEffectivePublicSharingDisabled(
      workspaceSettings,
      spaceSettings,
    );
  }
}
