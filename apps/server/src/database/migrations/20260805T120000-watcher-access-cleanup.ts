import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    delete from watchers as watcher
    where not exists (
      select 1
      from space_members as member
      where member.space_id = watcher.space_id
        and (
          member.user_id = watcher.user_id
          or exists (
            select 1
            from group_users as group_user
            where group_user.group_id = member.group_id
              and group_user.user_id = watcher.user_id
          )
        )
    )
  `.execute(db);
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Deleted watcher rows cannot be reconstructed reliably.
}
