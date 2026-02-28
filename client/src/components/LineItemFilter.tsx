import { useState, useRef, useEffect } from 'react';
import type { LineItemMeta } from '../../../shared/types';

interface Props {
  lineItem: LineItemMeta;
  values: string[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
}

export function LineItemFilter({ lineItem, values, selectedValues, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  const toggle = (val: string) => {
    if (selectedValues.includes(val)) {
      onChange(selectedValues.filter((v) => v !== val));
    } else {
      onChange([...selectedValues, val]);
    }
  };

  const selectAll = () => onChange([...values]);
  const clearAll = () => onChange([]);

  const hasSelection = selectedValues.length > 0;

  return (
    <div className="dimension-filter" ref={ref}>
      <button
        className={`filter-toggle ${hasSelection ? 'active' : ''}`}
        onClick={() => setOpen(!open)}
      >
        {lineItem.name}
        {hasSelection && <span className="filter-badge">{selectedValues.length}</span>}
      </button>

      {open && (
        <div className="filter-dropdown">
          {values.map((val) => (
            <label key={val} className="filter-option">
              <input
                type="checkbox"
                checked={selectedValues.includes(val)}
                onChange={() => toggle(val)}
              />
              {val}
            </label>
          ))}
          {values.length === 0 && (
            <div className="filter-empty">No values available</div>
          )}
          <div className="filter-actions">
            <button onClick={selectAll}>Select all</button>
            <button onClick={clearAll}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}
