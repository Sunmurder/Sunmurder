import { useState, useRef, useEffect } from 'react';
import type { LineItemMeta, NumericFilterOp } from '../../../shared/types';

interface Props {
  lineItem: LineItemMeta;
  activeFilter: { operator: NumericFilterOp; value?: number; valueHigh?: number } | null;
  onChange: (filter: { operator: NumericFilterOp; value?: number; valueHigh?: number } | null) => void;
}

const OPERATORS: { value: NumericFilterOp; label: string }[] = [
  { value: 'gte', label: '\u2265 More than or equal' },
  { value: 'gt', label: '> More than' },
  { value: 'lte', label: '\u2264 Less than or equal' },
  { value: 'lt', label: '< Less than' },
  { value: 'zero', label: '= Zero' },
  { value: 'non_zero', label: '\u2260 Non-zero' },
  { value: 'between', label: '\u2194 Between' },
];

export function NumericFilter({ lineItem, activeFilter, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [selectedOp, setSelectedOp] = useState<NumericFilterOp>(activeFilter?.operator ?? 'gte');
  const [value, setValue] = useState<string>(activeFilter?.value?.toString() ?? '');
  const [valueHigh, setValueHigh] = useState<string>(activeFilter?.valueHigh?.toString() ?? '');
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

  // Sync internal state when activeFilter changes externally
  useEffect(() => {
    if (activeFilter) {
      setSelectedOp(activeFilter.operator);
      setValue(activeFilter.value?.toString() ?? '');
      setValueHigh(activeFilter.valueHigh?.toString() ?? '');
    }
  }, [activeFilter]);

  const needsValue = !['zero', 'non_zero'].includes(selectedOp);
  const needsHighValue = selectedOp === 'between';

  const handleApply = () => {
    if (needsValue && value === '') return;
    if (needsHighValue && valueHigh === '') return;
    onChange({
      operator: selectedOp,
      value: needsValue ? parseFloat(value) : undefined,
      valueHigh: needsHighValue ? parseFloat(valueHigh) : undefined,
    });
    setOpen(false);
  };

  const handleClear = () => {
    onChange(null);
    setValue('');
    setValueHigh('');
    setSelectedOp('gte');
    setOpen(false);
  };

  const hasFilter = activeFilter !== null;

  const getFilterSummary = () => {
    if (!activeFilter) return '';
    const op = OPERATORS.find((o) => o.value === activeFilter.operator);
    const label = op?.label.split(' ')[0] ?? '';
    if (activeFilter.operator === 'zero') return '= 0';
    if (activeFilter.operator === 'non_zero') return '\u2260 0';
    if (activeFilter.operator === 'between')
      return `${activeFilter.value}\u2013${activeFilter.valueHigh}`;
    return `${label} ${activeFilter.value}`;
  };

  return (
    <div className="numeric-filter" ref={ref}>
      <button
        className={`filter-toggle ${hasFilter ? 'active' : ''}`}
        onClick={() => setOpen(!open)}
      >
        {lineItem.name}
        {hasFilter && <span className="filter-badge-text">{getFilterSummary()}</span>}
      </button>

      {open && (
        <div className="filter-dropdown numeric-dropdown">
          <div className="numeric-operator-list">
            {OPERATORS.map((op) => (
              <label key={op.value} className="filter-option">
                <input
                  type="radio"
                  name={`op-${lineItem.id}`}
                  checked={selectedOp === op.value}
                  onChange={() => setSelectedOp(op.value)}
                />
                {op.label}
              </label>
            ))}
          </div>

          {needsValue && (
            <div className="numeric-inputs">
              <input
                type="number"
                className="numeric-input"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={needsHighValue ? 'Min value' : 'Value'}
                step="any"
              />
              {needsHighValue && (
                <>
                  <span className="numeric-separator">to</span>
                  <input
                    type="number"
                    className="numeric-input"
                    value={valueHigh}
                    onChange={(e) => setValueHigh(e.target.value)}
                    placeholder="Max value"
                    step="any"
                  />
                </>
              )}
            </div>
          )}

          <div className="filter-actions">
            <button onClick={handleApply}>Apply</button>
            <button onClick={handleClear}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}
