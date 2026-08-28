// Stand-in for server/src/platform/container.ts.
import type { Db } from './db.js';
import type { GitHubClient } from './adapters.js';

export interface Container {
  db: Db;
  github: GitHubClient;
  secrets: { get(key: string): Promise<string | null> };
}
