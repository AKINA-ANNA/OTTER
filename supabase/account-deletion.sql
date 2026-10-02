-- ============================================================
-- ACCOUNT DELETION
-- ------------------------------------------------------------
-- Lets a signed-in user erase their own account from any of the
-- three consoles. The browser verifies ownership with a Supabase
-- email OTP first, then calls delete_my_account() below.
--
-- Safe to re-run: every statement is guarded.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Unblock the delete itself.
--
-- Columns that reference auth.users without an ON DELETE rule
-- abort the delete for anyone who has ever reviewed a proposal,
-- lended a part, filed a flag, run the registry or laid a ban.
-- Dropping the reference keeps the operational record (the row,
-- the review note, the timestamps) while letting the person go.
-- ------------------------------------------------------------
do $$
declare
    column_spec record;
    constraint_label text;
begin
    for column_spec in
        select *
        from (values
            ('public', 'user_bans',         'banned_by'),
            ('public', 'moderation_flags',  'reviewed_by'),
            ('public', 'inventory_parts',   'updated_by'),
            ('public', 'part_proposals',    'reviewed_by'),
            ('public', 'part_proposals',    'lent_by'),
            ('public', 'part_folders',      'created_by'),
            ('public', 'registry_settings', 'updated_by')
        ) as spec(table_schema, table_name, column_name)
    loop
        begin
            if to_regclass(format('%I.%I', column_spec.table_schema, column_spec.table_name)) is null then
                continue;
            end if;

            constraint_label := column_spec.table_name || '_' || column_spec.column_name || '_fkey';

            execute format('alter table %I.%I drop constraint if exists %I',
                column_spec.table_schema, column_spec.table_name, constraint_label);

            execute format('alter table %I.%I alter column %I drop not null',
                column_spec.table_schema, column_spec.table_name, column_spec.column_name);

            execute format('alter table %I.%I add constraint %I foreign key (%I) references auth.users(id) on delete set null',
                column_spec.table_schema, column_spec.table_name, constraint_label, column_spec.column_name);
        exception when others then
            raise notice 'left as-is: %.% (%)', column_spec.table_name, column_spec.column_name, sqlerrm;
        end;
    end loop;
end $$;


-- The student profile table predates supabase-admin.sql, so its
-- foreign key is repointed here by inspection rather than by name.
do $$
declare
    existing_constraint text;
begin
    if to_regclass('public.profiles') is null then
        return;
    end if;

    select con.conname into existing_constraint
    from pg_constraint con
    where con.conrelid = 'public.profiles'::regclass
      and con.contype = 'f'
      and con.confrelid = 'auth.users'::regclass
    limit 1;

    if existing_constraint is not null then
        execute format('alter table public.profiles drop constraint %I', existing_constraint);
        execute 'alter table public.profiles add constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade';
    end if;
exception when others then
    raise notice 'profiles foreign key left as-is: %', sqlerrm;
end $$;


-- ------------------------------------------------------------
-- 2. The wipe.
--
-- Caller-only by construction: it operates on auth.uid() and takes
-- no arguments, so there is no id to tamper with and one account
-- can never reach another's data.
--
-- The email code is checked by Supabase before the console calls
-- this (signInWithOtp + verifyOtp). That gate necessarily
-- lives in the browser - a buildless client cannot hold a secret -
-- so this function's job is to make the blast radius of a stolen
-- session exactly one account: its own.
-- ------------------------------------------------------------
create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = public, storage, extensions, auth
as $$
declare
    v_uid uuid := auth.uid();
    v_email text;
    child record;
    bucket_label text;
    removed_rows integer;
    removed_files integer := 0;
begin
    if v_uid is null then
        raise exception 'not_signed_in';
    end if;

    select users.email into v_email
    from auth.users users
    where users.id = v_uid;

    -- An admin deleting themselves must not be the one that empties
    -- the admin console for good.
    if to_regclass('public.admin_users') is not null then
        if exists (select 1 from public.admin_users where user_id = v_uid)
           and (select count(*) from public.admin_users) <= 1 then
            raise exception 'last_admin';
        end if;
    end if;

    -- Uploaded files sit outside the database graph, so no cascade
    -- reaches them. Both the per-user folder and legacy rows that
    -- only recorded an owner are cleared.
    --
    -- storage.objects.owner_id is text while auth.uid() is uuid, so the
    -- comparison has to be made on text. Comparing them directly raises
    -- "operator does not exist: text = uuid" (SQLSTATE 42883) and aborts
    -- the whole delete. Both ownership columns are covered because
    -- owner_id is current and owner is the deprecated uuid one.
    foreach bucket_label in array array['announcement-files', 'part-photos', 'part-pickups'] loop
        if to_regclass('storage.objects') is null
           or not exists (select 1 from storage.buckets where name = bucket_label) then
            continue;
        end if;

        begin
            delete from storage.objects
            where bucket_id = bucket_label
              and (name like v_uid::text || '/%'
                   or owner_id = v_uid::text
                   or owner::text = v_uid::text);
            get diagnostics removed_rows = row_count;
            removed_files := removed_files + removed_rows;
        exception when others then
            -- An unexpected storage schema must never be the reason an
            -- account cannot be deleted; fall back, then give up on
            -- this bucket only.
            begin
                delete from storage.objects
                where bucket_id = bucket_label
                  and (name like v_uid::text || '/%' or owner_id = v_uid::text);
                get diagnostics removed_rows = row_count;
                removed_files := removed_files + removed_rows;
            exception when others then
                raise notice 'storage cleanup skipped for %: %', bucket_label, sqlerrm;
            end;
        end;
    end loop;

    -- Best-effort sweep of every table pointing at the account.
    -- Rows a cascade already took are simply gone; anything a
    -- constraint still holds is left to the cascade at the end.
    for child in
        select nsp.nspname as table_schema,
               cls.relname as table_name,
               att.attname as column_name
        from pg_constraint con
        join pg_class cls on cls.oid = con.conrelid
        join pg_namespace nsp on nsp.oid = cls.relnamespace
        join lateral unnest(con.conkey) with ordinality as key(attnum, position) on true
        join pg_attribute att on att.attrelid = cls.oid and att.attnum = key.attnum
        where con.contype = 'f'
          and con.confrelid = 'auth.users'::regclass
          and con.conkey[1] = att.attnum
          and cls.relkind = 'r'
          and nsp.nspname not in ('auth', 'storage')
    loop
        begin
            execute format('delete from %I.%I where %I = $1',
                child.table_schema, child.table_name, child.column_name)
                using v_uid;
        exception when others then
            raise notice 'deferred to cascade: %.% (%)', child.table_name, child.column_name, sqlerrm;
        end;
    end loop;

    -- Everything that referenced the account directly has cascaded
    -- by now: proposals, interests, shares, notices, bans, flags,
    -- role rows and the profile row.
    delete from auth.users where id = v_uid;

    if not found then
        raise exception 'not_signed_in';
    end if;

    return jsonb_build_object(
        'email', v_email,
        'buckets_cleared', removed_files,
        'deleted_at', now()
    );
end;
$$;

revoke execute on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;