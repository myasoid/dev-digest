import type { Container } from '../container.js';
import { AgentRepository } from '../agents/repository.js';
import { CommentRepository } from './repository.js';

/**
 * Comments service. Resolves a comment along with the agent that authored it,
 * so the UI can show the agent's display name next to the comment body.
 */
export class CommentService {
  private comments: CommentRepository;
  private agents: AgentRepository;

  constructor(private container: Container) {
    this.comments = new CommentRepository(container.db);
    this.agents = new AgentRepository(container.db);
  }

  async getWithAuthor(workspaceId: string, commentId: string, agentId: string) {
    const comment = await this.comments.findComment({ workspaceId, commentId });
    const agent = await this.agents.getById(workspaceId, agentId);
    return { comment, agent };
  }
}
