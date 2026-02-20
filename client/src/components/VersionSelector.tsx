import type { DimensionItem } from '../../../shared/types';

interface Props {
  versions: DimensionItem[];
  selectedVersion: string;
  onSelectVersion: (id: string) => void;
}

export function VersionSelector({
  versions,
  selectedVersion,
  onSelectVersion,
}: Props) {
  return (
    <div className="version-selector">
      <label
        style={{
          fontSize: 12,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--text-secondary)',
        }}
      >
        Version / Scenario
      </label>
      <div className="version-pills">
        {versions.map((v) => (
          <button
            key={v.id}
            className={`version-pill ${v.id === selectedVersion ? 'active' : ''}`}
            onClick={() => onSelectVersion(v.id)}
          >
            {v.name}
          </button>
        ))}
      </div>
    </div>
  );
}
