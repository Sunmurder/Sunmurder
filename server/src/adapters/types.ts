import type {
  WorkspaceInfo,
  WorkspaceSchema,
  DimensionItem,
  ModuleDataRequest,
  ModuleDataResponse,
  CellWrite,
  CellWriteResult,
} from '../../../shared/types.js';

/**
 * Every planning engine must implement this interface.
 * The server never touches engine-specific APIs directly —
 * it delegates everything through an adapter.
 */
export interface EngineAdapter {
  /** Unique engine identifier (e.g. "mock", "anaplan") */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Engine type label */
  readonly type: string;

  // ── lifecycle ──
  connect(config?: Record<string, string>): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // ── navigation ──
  getWorkspaces(): Promise<WorkspaceInfo[]>;

  // ── schema discovery ──
  getSchema(workspaceId: string): Promise<WorkspaceSchema>;
  getDimensionItems(
    workspaceId: string,
    dimensionId: string,
    parentFilter?: { dimensionId: string; itemIds: string[] },
  ): Promise<DimensionItem[]>;

  // ── data ──
  getModuleData(
    workspaceId: string,
    moduleId: string,
    request: ModuleDataRequest,
  ): Promise<ModuleDataResponse>;

  writeCells(
    workspaceId: string,
    moduleId: string,
    version: string,
    cells: CellWrite[],
  ): Promise<CellWriteResult>;
}
