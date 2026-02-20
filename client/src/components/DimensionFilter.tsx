import { useState, useRef, useEffect } from 'react';
import type { Dimension, DimensionItem } from '../../../shared/types';

interface Props {
  dimension: Dimension;
  items: DimensionItem[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function DimensionFilter({ dimension, items, selectedIds, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const selectAll = () => onChange(items.map((i) => i.id));
  const clearAll = () => onChange([]);

  const hasSelection = selectedIds.length > 0;

  return (
    <div className="dimension-filter" ref={ref}>
      <button
        className={`filter-toggle ${hasSelection ? 'active' : ''}`}
        onClick={() => setOpen(!open)}
      >
        {dimension.name}
        {hasSelection && <span className="filter-badge">{selectedIds.length}</span>}
      </button>

      {open && (
        <div className="filter-dropdown">
          {items.map((item) => (
            <label key={item.id} className="filter-option">
              <input
                type="checkbox"
                checked={selectedIds.includes(item.id)}
                onChange={() => toggle(item.id)}
              />
              {item.name}
            </label>
          ))}
          <div className="filter-actions">
            <button onClick={selectAll}>Select all</button>
            <button onClick={clearAll}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}
