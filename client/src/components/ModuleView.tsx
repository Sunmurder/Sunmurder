import type { ModuleMeta } from '../../../shared/types';

interface Props {
  modules: ModuleMeta[];
  selectedModule: string;
  onSelectModule: (id: string) => void;
}

export function ModuleView({ modules, selectedModule, onSelectModule }: Props) {
  return (
    <div className="module-tabs">
      {modules.map((mod) => (
        <button
          key={mod.id}
          className={`module-tab ${mod.id === selectedModule ? 'active' : ''}`}
          onClick={() => onSelectModule(mod.id)}
        >
          {mod.name}
        </button>
      ))}
    </div>
  );
}
