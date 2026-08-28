import type { Db } from './db.js';
import { labels } from './db.js';
import type { Label } from './shared.js';

/**
 * Labels data-access layer. The only place that touches the `labels` table.
 */
export class LabelRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<Label[]> {
    return this.db.select().from(labels).where({ workspaceId });
  }

  async insert(workspaceId: string, name: string, color: string): Promise<Label> {
    const [row] = await this.db
      .insert(labels)
      .values({ workspaceId, name, color })
      .returning();
    return row;
  }
}
