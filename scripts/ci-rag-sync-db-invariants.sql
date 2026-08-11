\set ON_ERROR_STOP on

do $$
declare
  first_binding rag_sync_bindings%rowtype;
  second_binding rag_sync_bindings%rowtype;
  claimed_fingerprint varchar;
  tested_binding_count integer;
  untested_binding_count integer;
  state_default text;
  cleanup_default text;
  config_version_default text;
  target_version_default text;
begin
  select * into first_binding
  from rag_sync_bindings
  where state = 'enabled'
  order by id
  limit 1;

  select * into second_binding
  from rag_sync_bindings
  where state = 'enabled' and id <> first_binding.id
  order by id
  limit 1;

  if first_binding.id is null or second_binding.id is null then
    raise exception 'RAG sync invariant smoke requires two enabled bindings';
  end if;

  select
    count(*) filter (where last_tested_at is not null),
    count(*) filter (where last_tested_at is null)
  into tested_binding_count, untested_binding_count
  from rag_sync_bindings
  where state = 'enabled';

  if tested_binding_count <> 1 or untested_binding_count <> 1 then
    raise exception 'RAG sync target-test invalidation smoke state was not preserved';
  end if;

  select target_fingerprint into claimed_fingerprint
  from rag_sync_target_claims
  where id = first_binding.target_claim_id;

  if claimed_fingerprint is null then
    raise exception 'Enabled RAG sync binding has no active target claim';
  end if;

  select column_default into state_default
  from information_schema.columns
  where table_schema = current_schema()
    and table_name = 'rag_sync_bindings'
    and column_name = 'state';
  select column_default into cleanup_default
  from information_schema.columns
  where table_schema = current_schema()
    and table_name = 'rag_sync_bindings'
    and column_name = 'cleanup_required';
  select column_default into config_version_default
  from information_schema.columns
  where table_schema = current_schema()
    and table_name = 'rag_sync_bindings'
    and column_name = 'config_version';
  select column_default into target_version_default
  from information_schema.columns
  where table_schema = current_schema()
    and table_name = 'rag_sync_bindings'
    and column_name = 'target_version';

  if state_default not like '%disabled%'
     or cleanup_default not like '%false%'
     or config_version_default not like '1%'
     or target_version_default not like '1%' then
    raise exception 'Unexpected RAG sync binding defaults';
  end if;

  begin
    update rag_sync_bindings
    set cleanup_required = true
    where id = first_binding.id;
    raise exception 'enabled + cleanup_required was accepted' using errcode = 'P0001';
  exception when check_violation then
    null;
  end;

  begin
    update rag_sync_bindings
    set state = 'draining', cleanup_required = false
    where id = first_binding.id;
    raise exception 'draining without cleanup was accepted' using errcode = 'P0001';
  exception when check_violation then
    null;
  end;

  begin
    update rag_sync_bindings
    set state = 'disabled', cleanup_required = true, target_claim_id = null
    where id = first_binding.id;
    raise exception 'cleanup without target claim was accepted' using errcode = 'P0001';
  exception when check_violation then
    null;
  end;

  begin
    update rag_sync_bindings
    set writer_api_key_encrypted = 'plaintext'
    where id = first_binding.id;
    raise exception 'plaintext writer key was accepted' using errcode = 'P0001';
  exception when check_violation then
    null;
  end;

  begin
    update rag_sync_bindings
    set workspace_id = gen_uuid_v7()
    where id = first_binding.id;
    raise exception 'mismatched workspace and space were accepted' using errcode = 'P0001';
  exception when check_violation then
    null;
  end;

  begin
    update rag_sync_bindings
    set base_url = 'https://mismatched-target.example'
    where id = first_binding.id;
    raise exception 'mismatched target fingerprint was accepted' using errcode = 'P0001';
  exception when check_violation then
    null;
  end;

  begin
    update rag_sync_target_claims
    set target_fingerprint = encode(digest('tampered-target', 'sha256'), 'hex')
    where id = first_binding.target_claim_id;
    raise exception 'mutated target claim fingerprint was accepted' using errcode = 'P0001';
  exception when check_violation then
    null;
  end;

  begin
    insert into rag_sync_target_claims (
      workspace_id,
      space_id,
      binding_id,
      target_fingerprint,
      state
    ) values (
      second_binding.workspace_id,
      second_binding.space_id,
      second_binding.id,
      claimed_fingerprint,
      'active'
    );
    raise exception 'duplicate target fingerprint was accepted' using errcode = 'P0001';
  exception when unique_violation then
    null;
  end;

  begin
    delete from rag_sync_target_claims
    where id = first_binding.target_claim_id;
    raise exception 'referenced active claim was deleted' using errcode = 'P0001';
  exception when foreign_key_violation or restrict_violation then
    null;
  end;

  begin
    delete from rag_sync_bindings where id = first_binding.id;
    raise exception 'unsafe binding deletion was accepted' using errcode = 'P0001';
  exception when check_violation then
    null;
  end;

  begin
    delete from spaces where id = first_binding.space_id;
    raise exception 'unsafe space deletion was accepted' using errcode = 'P0001';
  exception when check_violation then
    null;
  end;

  begin
    delete from workspaces where id = first_binding.workspace_id;
    raise exception 'unsafe workspace deletion was accepted' using errcode = 'P0001';
  exception when check_violation then
    null;
  end;
end;
$$;

select 'RAG sync PostgreSQL invariants passed' as result;
