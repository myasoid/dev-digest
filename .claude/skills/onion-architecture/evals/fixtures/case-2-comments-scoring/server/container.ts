// Stand-in for server/src/platform/container.ts.
import type { Db } from '../db.js';

export interface Container {
  db: Db;
  get agentsRepo(): import('./agents/repository.js').AgentRepository;
  get commentsRepo(): import('./comments/repository.js').CommentRepository;
}
