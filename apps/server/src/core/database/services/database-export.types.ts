export interface DatabaseExportTableState {
  database: any;
  properties: any[];
  rows: any[];
  allRowPageIds: Set<string>;
  propertiesById: Map<
    string,
    { id: string; type: string | null; settings?: unknown }
  >;
  pageTitleById: Map<string, string>;
}

export type DatabaseExportCellDisplay = (
  row: any,
  propertyId: string,
) => string;
