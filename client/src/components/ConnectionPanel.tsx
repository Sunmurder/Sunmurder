import type { EngineInfo, WorkspaceInfo, ModelInfo } from '../../../shared/types';

interface Props {
  engines: EngineInfo[];
  selectedEngine: string;
  onSelectEngine: (id: string) => void;
  workspaces: WorkspaceInfo[];
  selectedWorkspace: string;
  onSelectWorkspace: (id: string) => void;
  models: ModelInfo[];
  selectedModel: string;
  onSelectModel: (id: string) => void;
  showModels: boolean;
  onConnectClick?: () => void;
}

export function ConnectionPanel({
  engines,
  selectedEngine,
  onSelectEngine,
  workspaces,
  selectedWorkspace,
  onSelectWorkspace,
  models,
  selectedModel,
  onSelectModel,
  showModels,
  onConnectClick,
}: Props) {
  const engine = engines.find((e) => e.id === selectedEngine);
  const needsConnect = engine && !engine.connected && engine.type === 'anaplan';

  return (
    <div className="connection-panel">
      <div className="field">
        <label>Engine</label>
        <select
          value={selectedEngine}
          onChange={(e) => onSelectEngine(e.target.value)}
        >
          <option value="">Select engine...</option>
          {engines.map((eng) => (
            <option key={eng.id} value={eng.id}>
              {eng.name}
            </option>
          ))}
        </select>
      </div>

      {needsConnect && (
        <button className="btn-connect" onClick={onConnectClick}>
          Connect to Anaplan
        </button>
      )}

      {engine?.connected && selectedEngine && (
        <div className="field">
          <label>Workspace</label>
          <select
            value={selectedWorkspace}
            onChange={(e) => onSelectWorkspace(e.target.value)}
          >
            <option value="">Select workspace...</option>
            {workspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>
                {ws.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {showModels && selectedWorkspace && models.length > 0 && (
        <div className="field">
          <label>Model</label>
          <select
            value={selectedModel}
            onChange={(e) => onSelectModel(e.target.value)}
          >
            <option value="">Select model...</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {engine && (
        <div className="connection-status">
          <span className={`status-dot ${engine.connected ? 'connected' : ''}`} />
          {engine.connected ? 'Connected' : 'Disconnected'}
        </div>
      )}
    </div>
  );
}
