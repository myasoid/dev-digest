import type { Db } from './db.js';

export interface Container {
  db: Db;
  secrets: { get(key: string): Promise<string | null> };
}
