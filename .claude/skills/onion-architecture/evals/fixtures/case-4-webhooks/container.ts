// Stand-in for server/src/platform/container.ts.
import type { Db } from './db.js';
import type { NotificationClient } from './adapters.js';

export interface Container {
  db: Db;
  notifications: NotificationClient;
  secrets: { get(key: string): Promise<string | null> };
}
