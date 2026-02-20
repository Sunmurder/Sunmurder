// ── Dimension model ──

export interface Dimension {
  id: string;
  name: string;
  /** If set, items in this dimension can be filtered by a parent dimension */
  parentDimensionId?: string;
}

export interface DimensionItem {
  id: string;
  name: string;
  /** Parent item id within the parent dimension (for cascading) */
  parentItemId?: string;
}

// ── Module / line-item metadata ──

export interface LineItemMeta {
  id: string;
  name: string;
  format: CellFormat;
  editable: boolean;
}

export type CellFormat = 'number' | 'currency' | 'percentage' | 'text';

export interface ModuleMeta {
  id: string;
  name: string;
  /** Ordered list of dimension IDs that define this module's axes */
  dimensionIds: string[];
  lineItems: LineItemMeta[];
}

// ── Schema discovery ──

export interface WorkspaceSchema {
  dimensions: Dimension[];
  modules: ModuleMeta[];
  versions: DimensionItem[];
}

// ── Data fetching / write-back ──

export interface ModuleDataRequest {
  /** dimensionId → selected item IDs */
  filters: Record<string, string[]>;
  version: string;
  /** Optional: restrict to one line item; omit to get all */
  lineItemId?: string;
  page?: number;
  pageSize?: number;
}

export interface ColumnDef {
  key: string;
  label: string;
  type: 'dimension' | 'value';
  format?: CellFormat;
  editable?: boolean;
  lineItemId?: string;
  timePeriodId?: string;
}

export interface DataRow {
  id: string;
  cells: Record<string, string | number | null>;
}

export interface ModuleDataResponse {
  columns: ColumnDef[];
  rows: DataRow[];
  page: number;
  pageSize: number;
  totalRows: number;
}

export interface CellWrite {
  rowId: string;
  columnKey: string;
  value: string | number;
}

export interface CellWriteResult {
  success: boolean;
  errors?: string[];
}

// ── Engine / workspace ──

export interface EngineInfo {
  id: string;
  name: string;
  type: string;
  connected: boolean;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
}
