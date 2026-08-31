export interface Db {
  select(): any;
  insert(table: any): any;
}
