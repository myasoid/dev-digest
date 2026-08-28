export interface Db {
  select(): any;
  insert(table: any): any;
}

export const annotations = { workspaceId: 'annotations.workspace_id', findingId: 'annotations.finding_id' };
