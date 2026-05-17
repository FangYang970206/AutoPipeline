import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import { migratePipelineSchema } from '../src/main/pipeline/schema.js';
import { migrateServerSchema } from '../src/main/server/schema.js';

let db: Database.Database | undefined;

export function getDatabase() {
  if (!db) {
    const dbPath = path.join(app.getPath('userData'), 'autopipeline.sqlite3');
    db = new Database(dbPath);
    db.pragma('foreign_keys = on');
    migrateServerSchema(db);
    migratePipelineSchema(db);
  }

  return db;
}
