import type { Db } from '../db.js';

export interface AgentRow {
  id: string;
  workspaceId: string;
  name: string;
  model: string;
}

/** Agents data-access layer. The only place that touches the `agents` table. */
export class AgentRepository {
  constructor(private db: Db) {}

  async getById(workspaceId: string, id: string): Promise<AgentRow | undefined> {
    const [row] = await this.db.select().from('agents').where({ workspaceId, id });
    return row;
  }
}
