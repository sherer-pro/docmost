import { Module } from '@nestjs/common';
import { GroupRepo } from '../repos/group/group.repo';
import { GroupUserRepo } from '../repos/group/group-user.repo';

@Module({
  providers: [GroupRepo, GroupUserRepo],
  exports: [GroupRepo, GroupUserRepo],
})
export class GroupPersistenceModule {}
