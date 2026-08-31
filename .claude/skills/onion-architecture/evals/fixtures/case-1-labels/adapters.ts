// Stand-in for server/src/adapters/github/*.
export interface GitHubClient {
  listLabelsForRepo(owner: string, name: string): Promise<{ name: string; color: string }[]>;
}

export class GitHubHttpClient implements GitHubClient {
  constructor(private token: string) {}

  async listLabelsForRepo(owner: string, name: string): Promise<{ name: string; color: string }[]> {
    const res = await fetch(`https://api.github.com/repos/${owner}/${name}/labels`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    return res.json();
  }
}
