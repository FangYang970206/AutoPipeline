import type { Database } from 'better-sqlite3';

export function migrateServerSchema(db: Database) {
  db.exec(`
    create table if not exists servers (
      id integer primary key autoincrement,
      display_name text not null,
      host text not null,
      port integer not null default 22,
      username text not null,
      auth_method text not null check (auth_method in ('password', 'key')),
      key_path text,
      connection_timeout integer not null default 30,
      keepalive_interval integer not null default 15,
      default_directory text,
      notes text not null default '',
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp
    );
  `);
}
