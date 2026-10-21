// Offline PostgreSQL permission checks. No .env or network/database credentials.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const { PGlite } = await import(process.env.PLANET_PGLITE_MODULE
  ? pathToFileURL(process.env.PLANET_PGLITE_MODULE).href
  : '@electric-sql/pglite')
const expectedAnon = {
  profiles: ['SELECT', 'INSERT', 'UPDATE'], checkins: ['SELECT', 'INSERT', 'UPDATE'],
  day_progress: ['SELECT', 'INSERT', 'UPDATE'], wishes: ['SELECT', 'INSERT', 'UPDATE'],
  backpack_items: ['SELECT', 'INSERT', 'DELETE'],
  photo_wall: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  daily_tasks: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  messages: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  meeting_dates: ['SELECT', 'INSERT', 'DELETE'], changelog: ['SELECT', 'INSERT', 'DELETE'],
  feedback: ['SELECT', 'INSERT', 'DELETE'], activity_logs: ['INSERT'], energy_events: [],
  music_tracks: [], music_requests: [],
}
for (const file of ['supabase_wwcxrl_schema.sql', 'supabase_wwcxrl_reset.sql', 'supabase_wwcxrl_music_patch.sql']) {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      create schema storage;
      create table storage.buckets (id text primary key, name text, public boolean,
        file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid default gen_random_uuid(), bucket_id text);
    `)
    const source = await readFile(new URL('../' + file, import.meta.url), 'utf8')
    // PGlite core provides gen_random_uuid; pgcrypto extension packaging is not needed here.
    const sql = source.replace(/create extension if not exists pgcrypto;/gi, '')
    await db.exec(sql)
    await db.exec(sql) // Repeatability of CREATE IF NOT EXISTS / policies / grants.
    const tables = [...source.matchAll(/create table if not exists public\.wwcxrl_(\w+)/g)].map(m => m[1])
    for (const table of tables) {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const allowed = role === 'anon' ? expectedAnon[table] : role === 'authenticated' ? []
          : table === 'music_tracks' ? ['SELECT', 'INSERT', 'UPDATE', 'DELETE']
            : table === 'music_requests' ? ['SELECT', 'INSERT', 'DELETE'] : ['SELECT']
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
          const { rows } = await db.query('select has_table_privilege($1, $2, $3) as allowed', [role, 'public.wwcxrl_' + table, privilege])
          assert.equal(rows[0].allowed, allowed.includes(privilege), `${file}: ${role} ${table} ${privilege}`)
        }
      }
    }
    const denied = async (role, statement) => {
      await db.exec(`set role ${role}`)
      try { await assert.rejects(db.exec(statement), error => error.code === '42501') }
      finally { await db.exec('reset role') }
    }
    await denied('anon', 'select * from public.wwcxrl_music_tracks')
    await denied('authenticated', 'select * from public.wwcxrl_music_requests')
    await denied('service_role', "update public.wwcxrl_music_requests set status = 'done'")
    await db.exec(`set role service_role;
      insert into public.wwcxrl_music_tracks(title) values ('test');
      update public.wwcxrl_music_tracks set title = 'edited';
      delete from public.wwcxrl_music_tracks;
      insert into public.wwcxrl_music_requests(content) values ('test') returning id;
      delete from public.wwcxrl_music_requests;
      reset role;`)
    if (tables.includes('profiles')) {
      await db.exec(`set role anon;
        insert into public.wwcxrl_profiles(id) values ('test');
        insert into public.wwcxrl_profiles(id, display_name) values ('test', 'edited')
          on conflict(id) do update set display_name = excluded.display_name;
        insert into public.wwcxrl_checkins(user_id, day, date) values ('test', 300, '2026-08-09');
        insert into public.wwcxrl_checkins(user_id, day, date, signed) values ('test', 300, '2026-08-09', true)
          on conflict(user_id, day) do update set signed = excluded.signed;
        insert into public.wwcxrl_backpack_items(user_id, item_id) values ('test', 'test');
        delete from public.wwcxrl_backpack_items where user_id = 'test';
        insert into public.wwcxrl_messages(user_id, content) values ('test', 'before');
      `)
      const { rows } = await db.query("update public.wwcxrl_messages set content = 'after' where content = 'before' returning content")
      assert.equal(rows[0]?.content, 'after', `${file}: message UPDATE must pass RLS`)
      await db.exec(`delete from public.wwcxrl_messages where user_id = 'test';
        insert into public.wwcxrl_activity_logs(user_id, event_type) values ('test', 'test'); reset role;`)
      await denied('anon', 'select * from public.wwcxrl_activity_logs')
      await denied('anon', 'select * from public.wwcxrl_energy_events')
      await denied('anon', 'delete from public.wwcxrl_profiles')
      await denied('anon', 'truncate public.wwcxrl_messages')
      await denied('service_role', "update public.wwcxrl_profiles set display_name = 'forbidden'")
    }
    console.log(`PASS ${file}: ${tables.length} tables, exact role ACLs, repeat execution, allowed writes and denied operations`)
  } finally { await db.close() }
}
