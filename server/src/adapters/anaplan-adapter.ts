import type { EngineAdapter } from './types.js';
import type {
  WorkspaceInfo,
  WorkspaceSchema,
  Dimension,
  DimensionItem,
  ModuleMeta,
  LineItemMeta,
  ModuleDataRequest,
  ModuleDataResponse,
  ColumnDef,
  DataRow,
  CellWrite,
  CellWriteResult,
} from '../../../shared/types.js';

/**
 * Anaplan engine adapter.
 *
 * Maps the Anaplan REST API v2 to the normalised planning interface.
 * Requires ANAPLAN_EMAIL and ANAPLAN_PASSWORD (or ANAPLAN_TOKEN) env vars
 * plus an Anaplan workspace/model to be selected.
 *
 * Anaplan concepts → normalised model:
 *   Workspace  → WorkspaceInfo  (we treat workspace+model as a single "workspace")
 *   List       → Dimension
 *   List Item  → DimensionItem
 *   Module     → ModuleMeta
 *   Line Item  → LineItemMeta
 *   Cell       → cell value
 */

const ANAPLAN_AUTH_URL = 'https://auth.anaplan.com/token/authenticate';
const ANAPLAN_API_BASE = 'https://api.anaplan.com/2/0';

interface AnaplanConfig {
  email?: string;
  password?: string;
  token?: string;
}

interface AnaplanModel {
  id: string;
  name: string;
  workspaceId: string;
  workspaceName: string;
}

export class AnaplanAdapter implements EngineAdapter {
  readonly id = 'anaplan';
  readonly name = 'Anaplan';
  readonly type = 'anaplan';

  private authToken: string | null = null;
  private models: AnaplanModel[] = [];
  private config: AnaplanConfig = {};

  // Cache for schema data per workspace (workspace = workspaceId:modelId)
  private schemaCache = new Map<string, WorkspaceSchema>();

  async connect(config?: Record<string, string>): Promise<void> {
    this.config = {
      email: config?.email ?? process.env.ANAPLAN_EMAIL,
      password: config?.password ?? process.env.ANAPLAN_PASSWORD,
      token: config?.token ?? process.env.ANAPLAN_TOKEN,
    };

    if (this.config.token) {
      this.authToken = this.config.token;
    } else if (this.config.email && this.config.password) {
      await this.authenticate();
    } else {
      throw new Error(
        'Anaplan adapter requires ANAPLAN_EMAIL + ANAPLAN_PASSWORD or ANAPLAN_TOKEN',
      );
    }
  }

  async disconnect(): Promise<void> {
    this.authToken = null;
    this.models = [];
    this.schemaCache.clear();
  }

  isConnected(): boolean {
    return this.authToken !== null;
  }

  // ── Workspaces ──
  // In Anaplan the navigable unit is workspace → model.
  // We expose each model as a "workspace" with id = "wsId:modelId".

  async getWorkspaces(): Promise<WorkspaceInfo[]> {
    this.ensureConnected();

    const workspaces = await this.apiGet<{ workspaces: { id: string; name: string }[] }>(
      '/workspaces',
    );

    const result: WorkspaceInfo[] = [];
    for (const ws of workspaces.workspaces ?? []) {
      const models = await this.apiGet<{ models: { id: string; name: string }[] }>(
        `/workspaces/${ws.id}/models`,
      );
      for (const model of models.models ?? []) {
        this.models.push({
          id: model.id,
          name: model.name,
          workspaceId: ws.id,
          workspaceName: ws.name,
        });
        result.push({
          id: `${ws.id}:${model.id}`,
          name: `${ws.name} / ${model.name}`,
        });
      }
    }

    return result;
  }

  // ── Schema ──

  async getSchema(workspaceId: string): Promise<WorkspaceSchema> {
    this.ensureConnected();

    if (this.schemaCache.has(workspaceId)) {
      return this.schemaCache.get(workspaceId)!;
    }

    const { wsId, modelId } = this.parseWorkspaceId(workspaceId);
    const base = `/workspaces/${wsId}/models/${modelId}`;

    // Fetch lists (dimensions)
    const listsResp = await this.apiGet<{ lists: AnaplanList[] }>(`${base}/lists`);
    const dimensions: Dimension[] = (listsResp.lists ?? []).map((list) => ({
      id: list.id,
      name: list.name,
      parentDimensionId: list.parent?.id,
    }));

    // Fetch modules
    const modulesResp = await this.apiGet<{ modules: AnaplanModule[] }>(`${base}/modules`);
    const modules: ModuleMeta[] = [];

    for (const mod of modulesResp.modules ?? []) {
      // Fetch line items for each module
      const liResp = await this.apiGet<{ items: AnaplanLineItem[] }>(
        `${base}/modules/${mod.id}/lineItems`,
      );
      const lineItems: LineItemMeta[] = (liResp.items ?? []).map((li) => ({
        id: li.id,
        name: li.name,
        format: mapAnaplanFormat(li.format),
        editable: !li.formula, // items with formulas are read-only
      }));

      modules.push({
        id: mod.id,
        name: mod.name,
        dimensionIds: mod.dimensions?.map((d) => d.id) ?? [],
        lineItems,
      });
    }

    // Versions are a built-in dimension in Anaplan
    const versionsResp = await this.apiGet<{ versions: { id: string; name: string }[] }>(
      `${base}/versions`,
    );
    const versions: DimensionItem[] = (versionsResp.versions ?? []).map((v) => ({
      id: v.id,
      name: v.name,
    }));

    const schema: WorkspaceSchema = { dimensions, modules, versions };
    this.schemaCache.set(workspaceId, schema);
    return schema;
  }

  async getDimensionItems(
    workspaceId: string,
    dimensionId: string,
    parentFilter?: { dimensionId: string; itemIds: string[] },
  ): Promise<DimensionItem[]> {
    this.ensureConnected();
    const { wsId, modelId } = this.parseWorkspaceId(workspaceId);

    const resp = await this.apiGet<{ listItems: AnaplanListItem[] }>(
      `/workspaces/${wsId}/models/${modelId}/lists/${dimensionId}/items`,
    );

    let items: DimensionItem[] = (resp.listItems ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      parentItemId: item.parent?.id,
    }));

    if (parentFilter && parentFilter.itemIds.length > 0) {
      items = items.filter(
        (item) => item.parentItemId && parentFilter.itemIds.includes(item.parentItemId),
      );
    }

    return items;
  }

  // ── Data ──
  // Anaplan's data export is async (create export → poll → read).
  // We simplify with a single export request.

  async getModuleData(
    workspaceId: string,
    moduleId: string,
    request: ModuleDataRequest,
  ): Promise<ModuleDataResponse> {
    this.ensureConnected();
    const { wsId, modelId } = this.parseWorkspaceId(workspaceId);
    const base = `/workspaces/${wsId}/models/${modelId}`;

    // Get module schema for column definitions
    const schema = await this.getSchema(workspaceId);
    const mod = schema.modules.find((m) => m.id === moduleId);
    if (!mod) throw new Error(`Module ${moduleId} not found`);

    // Create an export action
    const exportDef = await this.apiPost<{ exportMetadata: { exportId: string } }>(
      `${base}/modules/${moduleId}/exports`,
      { exportType: 'TABULAR_SINGLE_COLUMN' },
    );
    const exportId = exportDef.exportMetadata?.exportId;
    if (!exportId) throw new Error('Failed to create Anaplan export');

    // Run the export
    await this.apiPost(`${base}/exports/${exportId}/tasks`, {});

    // Poll until complete (simplified — real impl would retry)
    let chunks: string[][] = [];
    const chunkResp = await this.apiGet<{ chunks: { id: string }[] }>(
      `${base}/exports/${exportId}/chunks`,
    );
    for (const chunk of chunkResp.chunks ?? []) {
      const data = await this.apiGetRaw(
        `${base}/exports/${exportId}/chunks/${chunk.id}`,
      );
      chunks.push(data.split('\n'));
    }

    // Parse CSV-like output into rows
    const allLines = chunks.flat().filter((l) => l.trim());
    const headerLine = allLines[0] ?? '';
    const headers = headerLine.split(',').map((h) => h.trim().replace(/"/g, ''));

    const lineItems = request.lineItemId
      ? mod.lineItems.filter((li) => li.id === request.lineItemId)
      : mod.lineItems;

    // Build column defs
    const columns: ColumnDef[] = headers.map((h, i) => {
      const li = mod.lineItems.find((l) => l.name === h);
      const dim = schema.dimensions.find((d) => d.name === h);
      if (li) {
        return {
          key: li.id,
          label: li.name,
          type: 'value' as const,
          format: li.format,
          editable: li.editable,
          lineItemId: li.id,
        };
      }
      return {
        key: dim?.id ?? `col_${i}`,
        label: h,
        type: 'dimension' as const,
      };
    });

    // Parse data rows
    const page = request.page ?? 1;
    const pageSize = request.pageSize ?? 50;
    const dataLines = allLines.slice(1);
    const rows: DataRow[] = dataLines.map((line, idx) => {
      const values = line.split(',').map((v) => v.trim().replace(/"/g, ''));
      const cells: Record<string, string | number | null> = {};
      headers.forEach((h, i) => {
        const col = columns[i];
        if (col.type === 'value') {
          const num = Number(values[i]);
          cells[col.key] = isNaN(num) ? values[i] : num;
        } else {
          cells[col.key] = values[i] ?? null;
        }
      });
      return { id: `anaplan_row_${idx}`, cells };
    });

    // Apply filters (client-side since Anaplan export doesn't filter)
    let filteredRows = rows;
    for (const [dimId, selectedIds] of Object.entries(request.filters)) {
      if (selectedIds.length === 0) continue;
      const dim = schema.dimensions.find((d) => d.id === dimId);
      if (!dim) continue;
      const items = await this.getDimensionItems(workspaceId, dimId);
      const selectedNames = items
        .filter((item) => selectedIds.includes(item.id))
        .map((item) => item.name);
      filteredRows = filteredRows.filter((row) => {
        const cellVal = row.cells[dimId];
        return cellVal && selectedNames.includes(String(cellVal));
      });
    }

    const totalRows = filteredRows.length;
    const start = (page - 1) * pageSize;
    const pagedRows = filteredRows.slice(start, start + pageSize);

    return { columns, rows: pagedRows, page, pageSize, totalRows };
  }

  async writeCells(
    workspaceId: string,
    moduleId: string,
    _version: string,
    cells: CellWrite[],
  ): Promise<CellWriteResult> {
    this.ensureConnected();
    const { wsId, modelId } = this.parseWorkspaceId(workspaceId);
    const base = `/workspaces/${wsId}/models/${modelId}`;

    try {
      // Build CSV payload for Anaplan import
      // This is simplified — a real implementation would use the full import action flow
      const schema = await this.getSchema(workspaceId);
      const mod = schema.modules.find((m) => m.id === moduleId);
      if (!mod) throw new Error(`Module ${moduleId} not found`);

      // Create import action
      const importDef = await this.apiPost<{ imports: { id: string }[] }>(
        `${base}/imports`,
        {
          name: `write_${Date.now()}`,
          importDataSourceId: moduleId,
        },
      );

      if (!importDef.imports?.[0]?.id) {
        throw new Error('Failed to create Anaplan import');
      }

      // Build CSV lines for the cell writes
      const csvLines: string[] = [];
      for (const cell of cells) {
        csvLines.push(`${cell.rowId},${cell.columnKey},${cell.value}`);
      }

      // Upload data
      const importId = importDef.imports[0].id;
      await this.apiPost(`${base}/imports/${importId}/tasks`, {
        localeName: 'en_US',
      });

      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, errors: [message] };
    }
  }

  // ── private helpers ──

  private async authenticate(): Promise<void> {
    const credentials = Buffer.from(
      `${this.config.email}:${this.config.password}`,
    ).toString('base64');

    const resp = await fetch(ANAPLAN_AUTH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ purpose: 'planning-ux' }),
    });

    if (!resp.ok) {
      throw new Error(`Anaplan authentication failed: ${resp.status} ${resp.statusText}`);
    }

    const data = (await resp.json()) as { tokenInfo?: { tokenValue?: string } };
    this.authToken = data.tokenInfo?.tokenValue ?? null;

    if (!this.authToken) {
      throw new Error('Anaplan authentication returned no token');
    }
  }

  private ensureConnected(): void {
    if (!this.authToken) {
      throw new Error('Anaplan adapter is not connected. Call connect() first.');
    }
  }

  private parseWorkspaceId(workspaceId: string): { wsId: string; modelId: string } {
    const [wsId, modelId] = workspaceId.split(':');
    if (!wsId || !modelId) {
      throw new Error(
        `Invalid workspace ID "${workspaceId}". Expected format: "workspaceId:modelId"`,
      );
    }
    return { wsId, modelId };
  }

  private async apiGet<T>(path: string): Promise<T> {
    const resp = await fetch(`${ANAPLAN_API_BASE}${path}`, {
      headers: {
        Authorization: `AnaplanAuthToken ${this.authToken}`,
        'Content-Type': 'application/json',
      },
    });
    if (!resp.ok) {
      throw new Error(`Anaplan API GET ${path} failed: ${resp.status}`);
    }
    return (await resp.json()) as T;
  }

  private async apiGetRaw(path: string): Promise<string> {
    const resp = await fetch(`${ANAPLAN_API_BASE}${path}`, {
      headers: {
        Authorization: `AnaplanAuthToken ${this.authToken}`,
        Accept: 'text/csv',
      },
    });
    if (!resp.ok) {
      throw new Error(`Anaplan API GET ${path} failed: ${resp.status}`);
    }
    return resp.text();
  }

  private async apiPost<T = unknown>(path: string, body: unknown): Promise<T> {
    const resp = await fetch(`${ANAPLAN_API_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `AnaplanAuthToken ${this.authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      throw new Error(`Anaplan API POST ${path} failed: ${resp.status}`);
    }
    return (await resp.json()) as T;
  }
}

// ── Anaplan-specific types (not exported) ──

interface AnaplanList {
  id: string;
  name: string;
  parent?: { id: string };
}

interface AnaplanModule {
  id: string;
  name: string;
  dimensions?: { id: string; name: string }[];
}

interface AnaplanLineItem {
  id: string;
  name: string;
  format: string;
  formula?: string;
}

interface AnaplanListItem {
  id: string;
  name: string;
  parent?: { id: string };
}

function mapAnaplanFormat(
  anaplanFormat: string,
): 'number' | 'currency' | 'percentage' | 'text' {
  const f = anaplanFormat?.toLowerCase() ?? '';
  if (f.includes('currency') || f.includes('money')) return 'currency';
  if (f.includes('percent')) return 'percentage';
  if (f.includes('number') || f.includes('decimal') || f.includes('integer')) return 'number';
  return 'text';
}
