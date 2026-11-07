// PGlite 上的最小 Supabase 環境：anon／authenticated 角色、auth.users／auth.identities、auth.uid()、
// storage.buckets／storage.objects，以及 Supabase 對 public schema 的預設授權。
// 正式 SQL（schema.sql、patches）原封不動套上去，只拿掉 PGlite 沒有的 pgcrypto 擴充（gen_random_uuid 已內建）。
// 測試資料只用 example.com／example.test 的假 email，不含任何真實帳號或密碼。
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const readSql = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const STUB_SQL = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create schema storage;

create table auth.users (id uuid primary key, email text);
create table auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  identity_data jsonb not null default '{}'
);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

create table storage.buckets (
  id text primary key, name text not null, public boolean not null default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;

grant usage on schema public, auth, storage to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant select on storage.buckets to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

let PGliteClass = null;
async function loadPGlite() {
  if (PGliteClass === null) {
    try {
      ({ PGlite: PGliteClass } = await import('@electric-sql/pglite'));
    } catch {
      PGliteClass = false;
    }
  }
  return PGliteClass;
}

/** 建立資料庫並依序套用 schema.sql →（可選）安全強化 patch →（可選）學習資料庫 patch */
async function makeDb({ hardening = true, materials = true } = {}) {
  const PGlite = await loadPGlite();
  const db = new PGlite();
  await db.exec(STUB_SQL);
  await db.exec(readSql('supabase/schema.sql').replace(/^create extension if not exists pgcrypto;$/m, ''));
  if (hardening) await db.exec(readSql('supabase/patches/2026-10-19_security_hardening.sql'));
  if (materials) await db.exec(readSql('supabase/patches/2026-11-07_materials.sql'));
  return db;
}

/**
 * 以某個身分執行一句 SQL。who = null 為匿名；否則為 { id } 的登入使用者。
 * 預設執行完就 rollback（不改變共用的測試資料），keep: true 才保留。
 * 回傳 { ok, rows, affected, error }，不丟例外，方便寫權限矩陣。
 */
async function run(db, who, sql, params = [], { keep = false } = {}) {
  let result = null;
  try {
    await db.transaction(async (tx) => {
      if (who) {
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [who.id]);
        await tx.exec('set local role authenticated');
      } else {
        await tx.exec('set local role anon');
      }
      result = await tx.query(sql, params);
      if (!keep) await tx.rollback();
    });
    return { ok: true, rows: result.rows, affected: result.affectedRows ?? 0, error: null };
  } catch (error) {
    if (result && !keep) return { ok: true, rows: result.rows, affected: result.affectedRows ?? 0, error: null };
    return { ok: false, rows: [], affected: 0, error };
  }
}

module.exports = { loadPGlite, makeDb, run, readSql };
