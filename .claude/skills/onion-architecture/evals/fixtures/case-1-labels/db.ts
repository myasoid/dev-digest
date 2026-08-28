// Minimal stand-in for server/src/db/{client,schema}.ts.
export interface Db {
  select(): any;
  insert(table: any): any;
  update(table: any): any;
  delete(table: any): any;
}

export const labels = { workspaceId: 'labels.workspace_id', name: 'labels.name', id: 'labels.id' };
export const findings = { workspaceId: 'findings.workspace_id', labelId: 'findings.label_id', severity: 'findings.severity' };
