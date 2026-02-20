import { useState, useEffect, useCallback } from 'react';
import type {
  EngineInfo,
  WorkspaceInfo,
  WorkspaceSchema,
  DimensionItem,
  ModuleDataResponse,
  CellWrite,
} from '../../shared/types';
import * as api from './api';
import { ConnectionPanel } from './components/ConnectionPanel';
import { VersionSelector } from './components/VersionSelector';
import { DimensionFilter } from './components/DimensionFilter';
import { DataGrid } from './components/DataGrid';
import { ModuleView } from './components/ModuleView';

export default function App() {
  // ── connection state ──
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [selectedEngine, setSelectedEngine] = useState<string>('');
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('');
  const [schema, setSchema] = useState<WorkspaceSchema | null>(null);

  // ── planning state ──
  const [selectedModule, setSelectedModule] = useState<string>('');
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const [selectedLineItem, setSelectedLineItem] = useState<string>('');
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [moduleData, setModuleData] = useState<ModuleDataResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  // ── dimension items cache ──
  const [dimItemsCache, setDimItemsCache] = useState<Record<string, DimensionItem[]>>({});

  // Load engines on mount
  useEffect(() => {
    api.listEngines().then(setEngines).catch(console.error);
  }, []);

  // Load workspaces when engine is selected
  useEffect(() => {
    if (!selectedEngine) return;
    api.listWorkspaces(selectedEngine).then(setWorkspaces).catch(console.error);
  }, [selectedEngine]);

  // Load schema when workspace is selected
  useEffect(() => {
    if (!selectedEngine || !selectedWorkspace) return;
    api
      .getSchema(selectedEngine, selectedWorkspace)
      .then((s) => {
        setSchema(s);
        if (s.versions.length > 0) setSelectedVersion(s.versions[0].id);
        if (s.modules.length > 0) setSelectedModule(s.modules[0].id);
        setFilters({});
        setSelectedLineItem('');
      })
      .catch(console.error);
  }, [selectedEngine, selectedWorkspace]);

  // Load dimension items for the selected module's dimensions
  useEffect(() => {
    if (!schema || !selectedEngine || !selectedWorkspace || !selectedModule) return;
    const mod = schema.modules.find((m) => m.id === selectedModule);
    if (!mod) return;

    const loadItems = async () => {
      const cache: Record<string, DimensionItem[]> = {};
      for (const dimId of mod.dimensionIds) {
        const dim = schema.dimensions.find((d) => d.id === dimId);
        const parentFilter =
          dim?.parentDimensionId && filters[dim.parentDimensionId]?.length
            ? { dimensionId: dim.parentDimensionId, itemIds: filters[dim.parentDimensionId] }
            : undefined;
        cache[dimId] = await api.getDimensionItems(
          selectedEngine,
          selectedWorkspace,
          dimId,
          parentFilter,
        );
      }
      setDimItemsCache(cache);
    };

    loadItems().catch(console.error);
  }, [schema, selectedEngine, selectedWorkspace, selectedModule, filters]);

  // Load module data
  const fetchData = useCallback(
    async (p = 1) => {
      if (!selectedEngine || !selectedWorkspace || !selectedModule || !selectedVersion) return;
      setLoading(true);
      try {
        const data = await api.getModuleData(
          selectedEngine,
          selectedWorkspace,
          selectedModule,
          {
            filters,
            version: selectedVersion,
            lineItemId: selectedLineItem || undefined,
            page: p,
            pageSize: 50,
          },
        );
        setModuleData(data);
        setPage(p);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    },
    [selectedEngine, selectedWorkspace, selectedModule, selectedVersion, filters, selectedLineItem],
  );

  useEffect(() => {
    fetchData(1);
  }, [fetchData]);

  // Write-back handler
  const handleCellEdit = useCallback(
    async (rowId: string, columnKey: string, value: string | number) => {
      if (!selectedEngine || !selectedWorkspace || !selectedModule) return;
      const cells: CellWrite[] = [{ rowId, columnKey, value }];
      const result = await api.writeCells(
        selectedEngine,
        selectedWorkspace,
        selectedModule,
        selectedVersion,
        cells,
      );
      if (result.success) {
        // Refresh data to get recalculated values
        fetchData(page);
      } else {
        alert(`Write failed: ${result.errors?.join(', ')}`);
      }
    },
    [selectedEngine, selectedWorkspace, selectedModule, selectedVersion, fetchData, page],
  );

  const handleFilterChange = useCallback(
    (dimensionId: string, itemIds: string[]) => {
      setFilters((prev) => ({ ...prev, [dimensionId]: itemIds }));
    },
    [],
  );

  const currentModule = schema?.modules.find((m) => m.id === selectedModule);

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Planning UX</h1>
        <p className="app-subtitle">Engine-agnostic planning interface</p>
      </header>

      <ConnectionPanel
        engines={engines}
        selectedEngine={selectedEngine}
        onSelectEngine={setSelectedEngine}
        workspaces={workspaces}
        selectedWorkspace={selectedWorkspace}
        onSelectWorkspace={setSelectedWorkspace}
      />

      {schema && (
        <div className="planning-area">
          <div className="toolbar">
            <ModuleView
              modules={schema.modules}
              selectedModule={selectedModule}
              onSelectModule={(id) => {
                setSelectedModule(id);
                setSelectedLineItem('');
                setFilters({});
              }}
            />

            <VersionSelector
              versions={schema.versions}
              selectedVersion={selectedVersion}
              onSelectVersion={setSelectedVersion}
            />

            {currentModule && currentModule.lineItems.length > 1 && (
              <div className="line-item-selector">
                <label>Line Item</label>
                <select
                  value={selectedLineItem}
                  onChange={(e) => setSelectedLineItem(e.target.value)}
                >
                  <option value="">All Line Items</option>
                  {currentModule.lineItems.map((li) => (
                    <option key={li.id} value={li.id}>
                      {li.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {currentModule && (
            <div className="filters-bar">
              {currentModule.dimensionIds
                .filter((dimId) => dimId !== 'time')
                .map((dimId) => {
                  const dim = schema.dimensions.find((d) => d.id === dimId);
                  if (!dim) return null;
                  return (
                    <DimensionFilter
                      key={dimId}
                      dimension={dim}
                      items={dimItemsCache[dimId] ?? []}
                      selectedIds={filters[dimId] ?? []}
                      onChange={(ids) => handleFilterChange(dimId, ids)}
                    />
                  );
                })}
            </div>
          )}

          {moduleData && (
            <>
              <DataGrid
                columns={moduleData.columns}
                rows={moduleData.rows}
                onCellEdit={handleCellEdit}
                loading={loading}
              />

              <div className="pagination">
                <span className="pagination-info">
                  Showing {(moduleData.page - 1) * moduleData.pageSize + 1}–
                  {Math.min(moduleData.page * moduleData.pageSize, moduleData.totalRows)} of{' '}
                  {moduleData.totalRows}
                </span>
                <div className="pagination-buttons">
                  <button
                    disabled={page <= 1}
                    onClick={() => fetchData(page - 1)}
                  >
                    Previous
                  </button>
                  <button
                    disabled={page * moduleData.pageSize >= moduleData.totalRows}
                    onClick={() => fetchData(page + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
