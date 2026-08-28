import type { Db } from '../../db.js';

export interface FindCommentParams {
  workspaceId: string;
  commentId: string;
}

export interface CommentRow {
  id: string;
  workspaceId: string;
  runId: string;
  body: string;
}

export async function findComment(db: Db, params: FindCommentParams): Promise<CommentRow | undefined> {
  const [row] = await db.select().from('comments').where({ workspaceId: params.workspaceId, id: params.commentId });
  return row;
}
