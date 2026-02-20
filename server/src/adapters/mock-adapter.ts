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

// ── seed helpers ──

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ── static reference data ──

const VERSIONS: DimensionItem[] = [
  { id: 'actual', name: 'Actual' },
  { id: 'budget', name: 'Budget 2024' },
  { id: 'forecast', name: 'Forecast Q2' },
];

const DIMENSIONS: Dimension[] = [
  { id: 'time', name: 'Time Period' },
  { id: 'product', name: 'Product Line' },
  { id: 'region', name: 'Region', parentDimensionId: undefined },
  { id: 'subregion', name: 'Sub-Region', parentDimensionId: 'region' },
  { id: 'department', name: 'Department' },
];

const DIM_ITEMS: Record<string, DimensionItem[]> = {
  time: [
    { id: 'q1_24', name: 'Q1 2024' },
    { id: 'q2_24', name: 'Q2 2024' },
    { id: 'q3_24', name: 'Q3 2024' },
    { id: 'q4_24', name: 'Q4 2024' },
    { id: 'q1_25', name: 'Q1 2025' },
    { id: 'q2_25', name: 'Q2 2025' },
  ],
  product: [
    { id: 'electronics', name: 'Electronics' },
    { id: 'apparel', name: 'Apparel' },
    { id: 'home', name: 'Home & Garden' },
  ],
  region: [
    { id: 'na', name: 'North America' },
    { id: 'eu', name: 'Europe' },
    { id: 'apac', name: 'Asia Pacific' },
  ],
  subregion: [
    { id: 'us', name: 'United States', parentItemId: 'na' },
    { id: 'ca', name: 'Canada', parentItemId: 'na' },
    { id: 'uk', name: 'United Kingdom', parentItemId: 'eu' },
    { id: 'de', name: 'Germany', parentItemId: 'eu' },
    { id: 'fr', name: 'France', parentItemId: 'eu' },
    { id: 'jp', name: 'Japan', parentItemId: 'apac' },
    { id: 'au', name: 'Australia', parentItemId: 'apac' },
  ],
  department: [
    { id: 'sales', name: 'Sales' },
    { id: 'marketing', name: 'Marketing' },
    { id: 'operations', name: 'Operations' },
    { id: 'rnd', name: 'R&D' },
  ],
};

const MODULES: ModuleMeta[] = [
  {
    id: 'revenue',
    name: 'Revenue Planning',
    dimensionIds: ['time', 'product', 'subregion'],
    lineItems: [
      { id: 'units', name: 'Units Sold', format: 'number', editable: true },
      { id: 'price', name: 'Avg Price', format: 'currency', editable: true },
      { id: 'gross_rev', name: 'Gross Revenue', format: 'currency', editable: false },
      { id: 'discounts', name: 'Discounts', format: 'currency', editable: true },
      { id: 'net_rev', name: 'Net Revenue', format: 'currency', editable: false },
    ],
  },
  {
    id: 'expense',
    name: 'Expense Planning',
    dimensionIds: ['time', 'department', 'subregion'],
    lineItems: [
      { id: 'headcount', name: 'Headcount', format: 'number', editable: true },
      { id: 'avg_salary', name: 'Avg Salary', format: 'currency', editable: true },
      { id: 'travel', name: 'Travel & Expenses', format: 'currency', editable: true },
      { id: 'software', name: 'Software Costs', format: 'currency', editable: true },
      { id: 'total_exp', name: 'Total Expenses', format: 'currency', editable: false },
    ],
  },
  {
    id: 'pnl',
    name: 'P&L Summary',
    dimensionIds: ['time', 'product'],
    lineItems: [
      { id: 'revenue', name: 'Revenue', format: 'currency', editable: false },
      { id: 'cogs', name: 'COGS', format: 'currency', editable: true },
      { id: 'gross_profit', name: 'Gross Profit', format: 'currency', editable: false },
      { id: 'opex', name: 'OpEx', format: 'currency', editable: true },
      { id: 'ebitda', name: 'EBITDA', format: 'currency', editable: false },
      { id: 'net_income', name: 'Net Income', format: 'currency', editable: false },
    ],
  },
];

// ── Cell store key builder ──

type CellKey = string; // "moduleId|version|rowComposite|lineItem|timeId"

function cellKey(
  moduleId: string,
  version: string,
  rowDims: string[],
  lineItemId: string,
  timeId: string,
): CellKey {
  return `${moduleId}|${version}|${rowDims.join(',')}|${lineItemId}|${timeId}`;
}

// ── Mock Adapter ──

export class MockAdapter implements EngineAdapter {
  readonly id = 'mock';
  readonly name = 'Mock Planning Engine';
  readonly type = 'mock';

  private connected = false;
  private cells = new Map<CellKey, number>();

  async connect(): Promise<void> {
    this.connected = true;
    this.seedData();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.cells.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getWorkspaces(): Promise<WorkspaceInfo[]> {
    return [
      { id: 'demo', name: 'Demo Workspace' },
      { id: 'sandbox', name: 'Sandbox' },
    ];
  }

  async getSchema(_workspaceId: string): Promise<WorkspaceSchema> {
    return {
      dimensions: DIMENSIONS,
      modules: MODULES,
      versions: VERSIONS,
    };
  }

  async getDimensionItems(
    _workspaceId: string,
    dimensionId: string,
    parentFilter?: { dimensionId: string; itemIds: string[] },
  ): Promise<DimensionItem[]> {
    const items = DIM_ITEMS[dimensionId] ?? [];
    if (!parentFilter || !parentFilter.itemIds.length) return items;

    // Cascading: filter items whose parentItemId is in the parent selection
    return items.filter(
      (item) => item.parentItemId && parentFilter.itemIds.includes(item.parentItemId),
    );
  }

  async getModuleData(
    _workspaceId: string,
    moduleId: string,
    request: ModuleDataRequest,
  ): Promise<ModuleDataResponse> {
    const mod = MODULES.find((m) => m.id === moduleId);
    if (!mod) throw new Error(`Module ${moduleId} not found`);

    const version = request.version || 'actual';
    const page = request.page ?? 1;
    const pageSize = request.pageSize ?? 50;

    // Determine row dimensions (everything except time)
    const rowDimIds = mod.dimensionIds.filter((d) => d !== 'time');
    const timeDim = mod.dimensionIds.includes('time') ? 'time' : undefined;
    const timeItems = timeDim ? this.getFilteredItems('time', request.filters) : [{ id: '_', name: '' }];

    // Determine which line items to show
    const lineItems = request.lineItemId
      ? mod.lineItems.filter((li) => li.id === request.lineItemId)
      : mod.lineItems;

    // Build row combinations from row dimensions
    const rowCombinations = this.cartesian(
      rowDimIds.map((dimId) => {
        const items = this.getFilteredItems(dimId, request.filters);
        return items.map((item) => ({ dimId, item }));
      }),
    );

    // Build column definitions
    const columns: ColumnDef[] = [];
    for (const dimId of rowDimIds) {
      const dim = DIMENSIONS.find((d) => d.id === dimId)!;
      columns.push({ key: dimId, label: dim.name, type: 'dimension' });
    }
    for (const li of lineItems) {
      for (const tp of timeItems) {
        const key = timeDim ? `${li.id}__${tp.id}` : li.id;
        const label = timeDim ? `${li.name} - ${tp.name}` : li.name;
        columns.push({
          key,
          label,
          type: 'value',
          format: li.format,
          editable: li.editable,
          lineItemId: li.id,
          timePeriodId: timeDim ? tp.id : undefined,
        });
      }
    }

    // Build rows
    const allRows: DataRow[] = rowCombinations.map((combo, idx) => {
      const rowDimValues = combo.map((c) => c.item.id);
      const cells: Record<string, string | number | null> = {};

      for (const c of combo) {
        cells[c.dimId] = c.item.name;
      }

      for (const li of lineItems) {
        for (const tp of timeItems) {
          const key = timeDim ? `${li.id}__${tp.id}` : li.id;
          const ck = cellKey(moduleId, version, rowDimValues, li.id, tp.id);
          cells[key] = this.cells.get(ck) ?? null;
        }
      }

      return { id: `row_${idx}_${rowDimValues.join('_')}`, cells };
    });

    const totalRows = allRows.length;
    const start = (page - 1) * pageSize;
    const rows = allRows.slice(start, start + pageSize);

    return { columns, rows, page, pageSize, totalRows };
  }

  async writeCells(
    _workspaceId: string,
    moduleId: string,
    version: string,
    writes: CellWrite[],
  ): Promise<CellWriteResult> {
    const mod = MODULES.find((m) => m.id === moduleId);
    if (!mod) return { success: false, errors: [`Module ${moduleId} not found`] };

    const errors: string[] = [];

    for (const w of writes) {
      // Parse column key to get lineItemId and timeId
      const [lineItemId, timeId] = w.columnKey.includes('__')
        ? w.columnKey.split('__')
        : [w.columnKey, '_'];

      const li = mod.lineItems.find((l) => l.id === lineItemId);
      if (!li) {
        errors.push(`Line item ${lineItemId} not found`);
        continue;
      }
      if (!li.editable) {
        errors.push(`Line item ${li.name} is not editable`);
        continue;
      }

      // Extract row dimension values from rowId
      const rowDimValues = w.rowId.replace(/^row_\d+_/, '').split('_');
      const ck = cellKey(moduleId, version, rowDimValues, lineItemId, timeId);
      this.cells.set(ck, Number(w.value));
    }

    // Recalculate computed cells for affected rows
    this.recalculate(moduleId, version);

    return errors.length
      ? { success: false, errors }
      : { success: true };
  }

  // ── internal helpers ──

  private getFilteredItems(
    dimId: string,
    filters: Record<string, string[]>,
  ): DimensionItem[] {
    const allItems = DIM_ITEMS[dimId] ?? [];
    const selected = filters[dimId];
    if (selected && selected.length > 0) {
      return allItems.filter((item) => selected.includes(item.id));
    }

    // If the dimension has a parent, apply parent filter
    const dim = DIMENSIONS.find((d) => d.id === dimId);
    if (dim?.parentDimensionId) {
      const parentSelected = filters[dim.parentDimensionId];
      if (parentSelected && parentSelected.length > 0) {
        return allItems.filter(
          (item) => item.parentItemId && parentSelected.includes(item.parentItemId),
        );
      }
    }

    return allItems;
  }

  private cartesian<T>(arrays: T[][]): T[][] {
    if (arrays.length === 0) return [[]];
    return arrays.reduce<T[][]>(
      (acc, curr) => acc.flatMap((a) => curr.map((c) => [...a, c])),
      [[]],
    );
  }

  private seedData(): void {
    const rand = seededRandom(42);

    for (const version of VERSIONS) {
      const versionMultiplier =
        version.id === 'budget' ? 1.1 : version.id === 'forecast' ? 1.05 : 1.0;

      // Revenue module
      this.seedModule('revenue', version.id, versionMultiplier, rand, (rowDims, li, _tp) => {
        const product = rowDims[0]; // product line
        const baseByProduct: Record<string, number> = {
          electronics: 1.5,
          apparel: 0.8,
          home: 1.0,
        };
        const mult = baseByProduct[product] ?? 1;

        switch (li) {
          case 'units':
            return Math.round(500 + rand() * 2000 * mult);
          case 'price':
            return Math.round((20 + rand() * 80 * mult) * 100) / 100;
          default:
            return 0; // computed
        }
      });

      // Expense module
      this.seedModule('expense', version.id, versionMultiplier, rand, (_rowDims, li) => {
        switch (li) {
          case 'headcount':
            return Math.round(5 + rand() * 45);
          case 'avg_salary':
            return Math.round(50000 + rand() * 80000);
          case 'travel':
            return Math.round(5000 + rand() * 25000);
          case 'software':
            return Math.round(2000 + rand() * 15000);
          default:
            return 0;
        }
      });

      // P&L module
      this.seedModule('pnl', version.id, versionMultiplier, rand, (_rowDims, li) => {
        switch (li) {
          case 'revenue':
            return Math.round(100000 + rand() * 500000);
          case 'cogs':
            return Math.round(40000 + rand() * 200000);
          case 'opex':
            return Math.round(20000 + rand() * 100000);
          default:
            return 0;
        }
      });
    }

    // Run calculations after seeding
    for (const v of VERSIONS) {
      this.recalculate('revenue', v.id);
      this.recalculate('expense', v.id);
      this.recalculate('pnl', v.id);
    }
  }

  private seedModule(
    moduleId: string,
    version: string,
    versionMult: number,
    rand: () => number,
    valueFn: (rowDims: string[], lineItemId: string, timeId: string) => number,
  ): void {
    const mod = MODULES.find((m) => m.id === moduleId)!;
    const rowDimIds = mod.dimensionIds.filter((d) => d !== 'time');
    const timeItems = DIM_ITEMS['time'];

    const rowCombinations = this.cartesian(
      rowDimIds.map((dimId) => DIM_ITEMS[dimId].map((item) => item.id)),
    );

    for (const rowDims of rowCombinations) {
      for (const tp of timeItems) {
        for (const li of mod.lineItems) {
          if (!li.editable) continue; // skip computed
          const val = valueFn(rowDims, li.id, tp.id);
          const ck = cellKey(moduleId, version, rowDims, li.id, tp.id);
          this.cells.set(ck, Math.round(val * versionMult * 100) / 100);
        }
      }
    }
  }

  private recalculate(moduleId: string, version: string): void {
    const mod = MODULES.find((m) => m.id === moduleId)!;
    const rowDimIds = mod.dimensionIds.filter((d) => d !== 'time');
    const timeItems = DIM_ITEMS['time'];

    const rowCombinations = this.cartesian(
      rowDimIds.map((dimId) => DIM_ITEMS[dimId].map((item) => item.id)),
    );

    for (const rowDims of rowCombinations) {
      for (const tp of timeItems) {
        const get = (liId: string) =>
          this.cells.get(cellKey(moduleId, version, rowDims, liId, tp.id)) ?? 0;
        const set = (liId: string, val: number) =>
          this.cells.set(cellKey(moduleId, version, rowDims, liId, tp.id), Math.round(val * 100) / 100);

        if (moduleId === 'revenue') {
          const units = get('units');
          const price = get('price');
          const discounts = get('discounts');
          set('gross_rev', units * price);
          set('net_rev', units * price - discounts);
        } else if (moduleId === 'expense') {
          const headcount = get('headcount');
          const avgSalary = get('avg_salary');
          const travel = get('travel');
          const software = get('software');
          set('total_exp', headcount * avgSalary + travel + software);
        } else if (moduleId === 'pnl') {
          const revenue = get('revenue');
          const cogs = get('cogs');
          const opex = get('opex');
          set('gross_profit', revenue - cogs);
          set('ebitda', revenue - cogs - opex);
          set('net_income', (revenue - cogs - opex) * 0.75); // rough tax
        }
      }
    }
  }
}
