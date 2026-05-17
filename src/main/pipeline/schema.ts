import type { Database } from 'better-sqlite3';

export function migratePipelineSchema(db: Database) {
  db.exec(`
    create table if not exists folders (
      id integer primary key autoincrement,
      name text not null,
      parent_id integer references folders(id) on delete cascade,
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp
    );

    create table if not exists pipelines (
      id integer primary key autoincrement,
      name text not null,
      folder_id integer references folders(id) on delete set null,
      dag_edges text not null default '[]',
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp
    );

    create table if not exists execution_units (
      id text primary key,
      pipeline_id integer not null references pipelines(id) on delete cascade,
      name text not null,
      position text not null
    );

    create table if not exists commands (
      id text primary key,
      unit_id text not null references execution_units(id) on delete cascade,
      command_order integer not null,
      type text not null check (type in ('shell', 'transfer')),
      config text not null
    );

    create table if not exists runs (
      id integer primary key autoincrement,
      pipeline_id integer not null references pipelines(id) on delete cascade,
      status text not null,
      created_at text not null default current_timestamp
    );

    create table if not exists command_results (
      id integer primary key autoincrement,
      run_id integer not null references runs(id) on delete cascade,
      command_name text not null,
      status text not null,
      created_at text not null default current_timestamp
    );
  `);
}
