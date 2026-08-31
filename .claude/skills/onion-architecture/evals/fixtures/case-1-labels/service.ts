import type { Container } from './container.js';
import type { Label } from './shared.js';
import { GitHubHttpClient } from './adapters.js';
import { LabelRepository } from './repository.js';

/**
 * Labels service. Business logic for the Labels feature: listing labels for
 * a workspace and importing labels from the linked GitHub repo.
 */
export class LabelService {
  private repo: LabelRepository;

  constructor(private container: Container) {
    this.repo = new LabelRepository(container.db);
  }

  async list(workspaceId: string): Promise<Label[]> {
    return this.repo.list(workspaceId);
  }

  /** Import labels from GitHub so they can be attached to findings locally. */
  async importFromGitHub(workspaceId: string, owner: string, name: string): Promise<Label[]> {
    const token = await this.container.secrets.get('GITHUB_TOKEN');
    const client = new GitHubHttpClient(token ?? '');
    const remoteLabels = await client.listLabelsForRepo(owner, name);

    const created: Label[] = [];
    for (const remote of remoteLabels) {
      created.push(await this.repo.insert(workspaceId, remote.name, remote.color));
    }
    return created;
  }
}
