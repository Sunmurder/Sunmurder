import type {
  EngineInfo,
  WorkspaceInfo,
  WorkspaceSchema,
  DimensionItem,
  ModuleDataResponse,
  CellWrite,
  CellWriteResult,
} from '../../shared/types';

const BASE = '/api';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, init);
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`API ${resp.status}: ${body}`);
  }
  return resp.json() as Promise<T>;
}

// ── Engines ──

export function listEngines(): Promise<EngineInfo[]> {
  return fetchJson(`${BASE}/engines`);
}

export function connectEngine(
  engineId: string,
  config?: Record<string, string>,
): Promise<{ ok: boolean }> {
  return fetchJson(`${BASE}/engines/${engineId}/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config ?? {}),
  });
}

// ── Workspaces ──

export function listWorkspaces(engineId: string): Promise<WorkspaceInfo[]> {
  return fetchJson(`${BASE}/engines/${engineId}/workspaces`);
}

// ── Schema ──

export function getSchema(
  engineId: string,
  workspaceId: string,
): Promise<WorkspaceSchema> {
  return fetchJson(`${BASE}/engines/${engineId}/workspaces/${workspaceId}/schema`);
}

// ── Dimension items ──

export function getDimensionItems(
  engineId: string,
  workspaceId: string,
  dimensionId: string,
  parentFilter?: { dimensionId: string; itemIds: string[] },
): Promise<DimensionItem[]> {
  const params = new URLSearchParams();
  if (parentFilter) {
    params.set('parentDimensionId', parentFilter.dimensionId);
    params.set('parentItemIds', parentFilter.itemIds.join(','));
  }
  const qs = params.toString();
  return fetchJson(
    `${BASE}/engines/${engineId}/workspaces/${workspaceId}/dimensions/${dimensionId}/items${qs ? '?' + qs : ''}`,
  );
}

// ── Module data ──

export function getModuleData(
  engineId: string,
  workspaceId: string,
  moduleId: string,
  opts: {
    filters?: Record<string, string[]>;
    version?: string;
    lineItemId?: string;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<ModuleDataResponse> {
  const params = new URLSearchParams();
  if (opts.filters) params.set('filters', JSON.stringify(opts.filters));
  if (opts.version) params.set('version', opts.version);
  if (opts.lineItemId) params.set('lineItemId', opts.lineItemId);
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  const qs = params.toString();
  return fetchJson(
    `${BASE}/engines/${engineId}/workspaces/${workspaceId}/modules/${moduleId}/data${qs ? '?' + qs : ''}`,
  );
}

// ── Write-back ──

export function writeCells(
  engineId: string,
  workspaceId: string,
  moduleId: string,
  version: string,
  cells: CellWrite[],
): Promise<CellWriteResult> {
  return fetchJson(
    `${BASE}/engines/${engineId}/workspaces/${workspaceId}/modules/${moduleId}/cells`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, cells }),
    },
  );
}
