import type { Db } from '../db.js';

/**
 * Comments data-access facade. Wraps the split-out repository/*.repo.ts
 * files for the module's Drizzle queries.
 */
export class CommentRepository {
  constructor(private db: Db) {}

  async findComment(params: { workspaceId: string; commentId: string }) {
    const [row] = await this.db
      .select()
      .from('comments')
      .where({ workspaceId: params.workspaceId, id: params.commentId });
    return row;
  }
}
