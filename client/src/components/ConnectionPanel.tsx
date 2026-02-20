import type { EngineInfo, WorkspaceInfo } from '../../../shared/types';

interface Props {
  engines: EngineInfo[];
  selectedEngine: string;
  onSelectEngine: (id: string) => void;
  workspaces: WorkspaceInfo[];
  selectedWorkspace: string;
  onSelectWorkspace: (id: string) => void;
}

export function ConnectionPanel({
  engines,
  selectedEngine,
  onSelectEngine,
  workspaces,
  selectedWorkspace,
  onSelectWorkspace,
}: Props) {
  const engine = engines.find((e) => e.id === selectedEngine);

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

      {selectedEngine && (
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

      {engine && (
        <div className="connection-status">
          <span className={`status-dot ${engine.connected ? 'connected' : ''}`} />
          {engine.connected ? 'Connected' : 'Disconnected'}
        </div>
      )}
    </div>
  );
}
