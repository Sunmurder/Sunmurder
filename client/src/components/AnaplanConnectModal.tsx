import { useState } from 'react';
import type { SavedConnection } from '../../../shared/types';

interface Props {
  open: boolean;
  savedConnections: SavedConnection[];
  onConnect: (token: string, saveName?: string) => void;
  onUseSaved: (connId: string) => void;
  onDeleteSaved: (connId: string) => void;
  onClose: () => void;
  connecting: boolean;
  error: string | null;
}

export function AnaplanConnectModal({
  open,
  savedConnections,
  onConnect,
  onUseSaved,
  onDeleteSaved,
  onClose,
  connecting,
  error,
}: Props) {
  const [token, setToken] = useState('');
  const [saveName, setSaveName] = useState('');
  const [saveChecked, setSaveChecked] = useState(true);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    onConnect(token.trim(), saveChecked && saveName.trim() ? saveName.trim() : undefined);
  };

  const anaplanConnections = savedConnections.filter((c) => c.engineId === 'anaplan');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Connect to Anaplan</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        {anaplanConnections.length > 0 && (
          <div className="saved-connections">
            <h3>Saved Connections</h3>
            <div className="saved-list">
              {anaplanConnections.map((conn) => (
                <div key={conn.id} className="saved-item">
                  <div className="saved-info">
                    <span className="saved-name">{conn.name}</span>
                    <span className="saved-token">{conn.tokenPreview}</span>
                  </div>
                  <div className="saved-actions">
                    <button
                      className="btn-use"
                      onClick={() => onUseSaved(conn.id)}
                      disabled={connecting}
                    >
                      Connect
                    </button>
                    <button
                      className="btn-delete"
                      onClick={() => onDeleteSaved(conn.id)}
                      disabled={connecting}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="divider-text">
              <span>or enter a new token</span>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="connect-form">
          <div className="form-field">
            <label htmlFor="anaplan-token">API Token</label>
            <input
              id="anaplan-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste your Anaplan API token..."
              autoFocus
              disabled={connecting}
            />
          </div>

          <div className="form-field-row">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={saveChecked}
                onChange={(e) => setSaveChecked(e.target.checked)}
                disabled={connecting}
              />
              Save this connection
            </label>
          </div>

          {saveChecked && (
            <div className="form-field">
              <label htmlFor="conn-name">Connection Name</label>
              <input
                id="conn-name"
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="e.g. Production Workspace"
                disabled={connecting}
              />
            </div>
          )}

          {error && <div className="form-error">{error}</div>}

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={connecting}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={connecting || !token.trim()}>
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
