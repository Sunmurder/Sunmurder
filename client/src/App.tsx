import { useState, useEffect, useCallback } from 'react';
import type {
  EngineInfo,
  WorkspaceInfo,
  ModelInfo,
  WorkspaceSchema,
  DimensionItem,
  ModuleDataResponse,
  CellWrite,
  SavedConnection,
  NumericFilterDef,
  NumericFilterOp,
} from '../../shared/types';
import * as api from './api';
import { ConnectionPanel } from './components/ConnectionPanel';
import { VersionSelector } from './components/VersionSelector';
import { DimensionFilter } from './components/DimensionFilter';
import { LineItemFilter } from './components/LineItemFilter';
import { NumericFilter } from './components/NumericFilter';
import { DataGrid } from './components/DataGrid';
import { ModuleView } from './components/ModuleView';
import { AnaplanConnectModal } from './components/AnaplanConnectModal';

export default function App() {
  // ── connection state ──
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [selectedEngine, setSelectedEngine] = useState<string>('');
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [schema, setSchema] = useState<WorkspaceSchema | null>(null);

  // ── Anaplan connect modal ──
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [savedConnections, setSavedConnections] = useState<SavedConnection[]>([]);

  // ── planning state ──
  const [selectedModule, setSelectedModule] = useState<string>('');
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const [selectedLineItem, setSelectedLineItem] = useState<string>('');
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [lineItemFilters, setLineItemFilters] = useState<Record<string, string[]>>({});
  const [numericFilters, setNumericFilters] = useState<
    Record<string, { operator: NumericFilterOp; value?: number; valueHigh?: number }>
  >({});
  const [moduleData, setModuleData] = useState<ModuleDataResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  // ── dimension items cache ──
  const [dimItemsCache, setDimItemsCache] = useState<Record<string, DimensionItem[]>>({});

  // ── line item values cache (for text line items) ──
  const [liValuesCache, setLiValuesCache] = useState<Record<string, string[]>>({});

  // Determine engine type
  const currentEngine = engines.find((e) => e.id === selectedEngine);
  const isAnaplan = currentEngine?.type === 'anaplan';
  const showModels = isAnaplan && models.length > 0;

  // The effective workspace ID: for Anaplan with separate model selection, combine ws:model
  const effectiveWorkspaceId = isAnaplan && selectedModel
    ? `${selectedWorkspace}:${selectedModel}`
    : selectedWorkspace;

  // Load engines and saved connections on mount
  useEffect(() => {
    api.listEngines().then(setEngines).catch(console.error);
    api.listConnections().then(setSavedConnections).catch(console.error);
  }, []);

  // When engine is selected
  useEffect(() => {
    if (!selectedEngine) return;
    const eng = engines.find((e) => e.id === selectedEngine);
    if (!eng) return;

    // Reset downstream state
    setSelectedWorkspace('');
    setSelectedModel('');
    setModels([]);
    setSchema(null);
    setModuleData(null);

    if (eng.connected) {
      api.listWorkspaces(selectedEngine).then(setWorkspaces).catch(console.error);
    } else if (eng.type === 'anaplan') {
      setShowConnectModal(true);
    }
  }, [selectedEngine, engines]);

  // When workspace is selected, check for models (Anaplan) or load schema directly
  useEffect(() => {
    if (!selectedEngine || !selectedWorkspace) return;

    setSelectedModel('');
    setModels([]);
    setSchema(null);
    setModuleData(null);

    if (isAnaplan) {
      // For Anaplan, load models within the workspace
      api.listModels(selectedEngine, selectedWorkspace)
        .then((m) => {
          setModels(m);
          if (m.length === 0) {
            // No models endpoint / not Anaplan — load schema directly
            loadSchema(selectedWorkspace);
          }
        })
        .catch(() => {
          // Fallback: load schema directly if models endpoint fails
          loadSchema(selectedWorkspace);
        });
    } else {
      // Non-Anaplan engines: load schema directly
      loadSchema(selectedWorkspace);
    }
  }, [selectedEngine, selectedWorkspace, isAnaplan]);

  // When model is selected (Anaplan), load schema with combined workspace:model ID
  useEffect(() => {
    if (!isAnaplan || !selectedWorkspace || !selectedModel) return;
    const wsId = `${selectedWorkspace}:${selectedModel}`;
    loadSchema(wsId);
  }, [selectedModel]);

  function loadSchema(wsId: string) {
    api
      .getSchema(selectedEngine, wsId)
      .then((s) => {
        setSchema(s);
        if (s.versions.length > 0) setSelectedVersion(s.versions[0].id);
        if (s.modules.length > 0) setSelectedModule(s.modules[0].id);
        setFilters({});
        setLineItemFilters({});
        setNumericFilters({});
        setSelectedLineItem('');
      })
      .catch(console.error);
  }

  // Load dimension items for the selected module's dimensions
  useEffect(() => {
    if (!schema || !selectedEngine || !effectiveWorkspaceId || !selectedModule) return;
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
          effectiveWorkspaceId,
          dimId,
          parentFilter,
        );
      }
      setDimItemsCache(cache);
    };

    loadItems().catch(console.error);
  }, [schema, selectedEngine, effectiveWorkspaceId, selectedModule, filters]);

  // Load distinct values for text line items
  useEffect(() => {
    if (!schema || !selectedEngine || !effectiveWorkspaceId || !selectedModule || !selectedVersion) return;
    const mod = schema.modules.find((m) => m.id === selectedModule);
    if (!mod) return;

    const textLineItems = mod.lineItems.filter((li) => li.format === 'text');
    if (textLineItems.length === 0) {
      setLiValuesCache({});
      return;
    }

    const loadValues = async () => {
      const cache: Record<string, string[]> = {};
      for (const li of textLineItems) {
        cache[li.id] = await api.getLineItemValues(
          selectedEngine,
          effectiveWorkspaceId,
          selectedModule,
          li.id,
          selectedVersion,
        );
      }
      setLiValuesCache(cache);
    };

    loadValues().catch(console.error);
  }, [schema, selectedEngine, effectiveWorkspaceId, selectedModule, selectedVersion]);

  // Load module data
  const fetchData = useCallback(
    async (p = 1) => {
      if (!selectedEngine || !effectiveWorkspaceId || !selectedModule || !selectedVersion) return;
      setLoading(true);
      try {
        // Build numeric filters array
        const numFiltersArray: NumericFilterDef[] = Object.entries(numericFilters).map(
          ([lineItemId, f]) => ({
            lineItemId,
            operator: f.operator,
            value: f.value,
            valueHigh: f.valueHigh,
          }),
        );

        const data = await api.getModuleData(
          selectedEngine,
          effectiveWorkspaceId,
          selectedModule,
          {
            filters,
            lineItemFilters: Object.keys(lineItemFilters).length > 0 ? lineItemFilters : undefined,
            numericFilters: numFiltersArray.length > 0 ? numFiltersArray : undefined,
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
    [selectedEngine, effectiveWorkspaceId, selectedModule, selectedVersion, filters, lineItemFilters, numericFilters, selectedLineItem],
  );

  useEffect(() => {
    fetchData(1);
  }, [fetchData]);

  // Write-back handler
  const handleCellEdit = useCallback(
    async (rowId: string, columnKey: string, value: string | number) => {
      if (!selectedEngine || !effectiveWorkspaceId || !selectedModule) return;
      const cells: CellWrite[] = [{ rowId, columnKey, value }];
      const result = await api.writeCells(
        selectedEngine,
        effectiveWorkspaceId,
        selectedModule,
        selectedVersion,
        cells,
      );
      if (result.success) {
        fetchData(page);
      } else {
        alert(`Write failed: ${result.errors?.join(', ')}`);
      }
    },
    [selectedEngine, effectiveWorkspaceId, selectedModule, selectedVersion, fetchData, page],
  );

  const handleFilterChange = useCallback(
    (dimensionId: string, itemIds: string[]) => {
      setFilters((prev) => ({ ...prev, [dimensionId]: itemIds }));
    },
    [],
  );

  const handleLineItemFilterChange = useCallback(
    (lineItemId: string, values: string[]) => {
      setLineItemFilters((prev) => {
        const next = { ...prev };
        if (values.length === 0) {
          delete next[lineItemId];
        } else {
          next[lineItemId] = values;
        }
        return next;
      });
    },
    [],
  );

  const handleNumericFilterChange = useCallback(
    (lineItemId: string, filter: { operator: NumericFilterOp; value?: number; valueHigh?: number } | null) => {
      setNumericFilters((prev) => {
        const next = { ...prev };
        if (filter === null) {
          delete next[lineItemId];
        } else {
          next[lineItemId] = filter;
        }
        return next;
      });
    },
    [],
  );

  // ── Anaplan connect handlers ──

  const handleAnaplanConnect = async (token: string, saveName?: string) => {
    setConnecting(true);
    setConnectError(null);
    try {
      await api.connectEngine('anaplan', { token });
      if (saveName) {
        await api.saveConnection({ name: saveName, engineId: 'anaplan', token });
        const conns = await api.listConnections();
        setSavedConnections(conns);
      }
      // Refresh engines to get updated connected status
      const updatedEngines = await api.listEngines();
      setEngines(updatedEngines);
      setShowConnectModal(false);
      // Load workspaces
      const ws = await api.listWorkspaces('anaplan');
      setWorkspaces(ws);
    } catch (err: any) {
      setConnectError(err?.message || 'Connection failed');
    } finally {
      setConnecting(false);
    }
  };

  const handleUseSavedConnection = async (connId: string) => {
    setConnecting(true);
    setConnectError(null);
    try {
      await api.useSavedConnection(connId);
      const updatedEngines = await api.listEngines();
      setEngines(updatedEngines);
      setShowConnectModal(false);
      const ws = await api.listWorkspaces('anaplan');
      setWorkspaces(ws);
    } catch (err: any) {
      setConnectError(err?.message || 'Connection failed');
    } finally {
      setConnecting(false);
    }
  };

  const handleDeleteSavedConnection = async (connId: string) => {
    await api.deleteConnection(connId);
    const conns = await api.listConnections();
    setSavedConnections(conns);
  };

  const currentModule = schema?.modules.find((m) => m.id === selectedModule);
  const textLineItems = currentModule?.lineItems.filter((li) => li.format === 'text') ?? [];
  const numericLineItems = currentModule?.lineItems.filter(
    (li) => li.format === 'number' || li.format === 'currency' || li.format === 'percentage',
  ) ?? [];

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
        models={models}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
        showModels={showModels}
        onConnectClick={() => setShowConnectModal(true)}
      />

      <AnaplanConnectModal
        open={showConnectModal}
        savedConnections={savedConnections}
        onConnect={handleAnaplanConnect}
        onUseSaved={handleUseSavedConnection}
        onDeleteSaved={handleDeleteSavedConnection}
        onClose={() => setShowConnectModal(false)}
        connecting={connecting}
        error={connectError}
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
                setLineItemFilters({});
                setNumericFilters({});
              }}
            />

            <VersionSelector
              versions={schema.versions}
              selectedVersion={selectedVersion}
              onSelectVersion={setSelectedVersion}
            />

            {currentModule && currentModule.lineItems.filter((li) => li.format !== 'text').length > 1 && (
              <div className="line-item-selector">
                <label>Line Item</label>
                <select
                  value={selectedLineItem}
                  onChange={(e) => setSelectedLineItem(e.target.value)}
                >
                  <option value="">All Line Items</option>
                  {currentModule.lineItems
                    .filter((li) => li.format !== 'text')
                    .map((li) => (
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
              {/* Dimension filters */}
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

              {/* Text line item filters */}
              {textLineItems.length > 0 && (
                <>
                  <div className="filter-separator" />
                  {textLineItems.map((li) => (
                    <LineItemFilter
                      key={li.id}
                      lineItem={li}
                      values={liValuesCache[li.id] ?? []}
                      selectedValues={lineItemFilters[li.id] ?? []}
                      onChange={(vals) => handleLineItemFilterChange(li.id, vals)}
                    />
                  ))}
                </>
              )}

              {/* Numeric filters */}
              {numericLineItems.length > 0 && (
                <>
                  <div className="filter-separator" />
                  {numericLineItems.map((li) => (
                    <NumericFilter
                      key={li.id}
                      lineItem={li}
                      activeFilter={numericFilters[li.id] ?? null}
                      onChange={(f) => handleNumericFilterChange(li.id, f)}
                    />
                  ))}
                </>
              )}
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
                  Showing {moduleData.totalRows === 0 ? 0 : (moduleData.page - 1) * moduleData.pageSize + 1}–
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
