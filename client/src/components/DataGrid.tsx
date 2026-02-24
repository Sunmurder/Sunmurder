import { useState, useCallback } from 'react';
import type { ColumnDef, DataRow } from '../../../shared/types';

interface Props {
  columns: ColumnDef[];
  rows: DataRow[];
  onCellEdit: (rowId: string, columnKey: string, value: string | number) => void;
  loading: boolean;
}

function formatValue(value: string | number | null, format?: string): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;

  switch (format) {
    case 'currency':
      return value.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });
    case 'percentage':
      return `${(value * 100).toFixed(1)}%`;
    case 'number':
      return value.toLocaleString('en-US');
    default:
      return String(value);
  }
}

export function DataGrid({ columns, rows, onCellEdit, loading }: Props) {
  const [editingCell, setEditingCell] = useState<{
    rowId: string;
    colKey: string;
  } | null>(null);
  const [editValue, setEditValue] = useState('');

  const startEdit = useCallback(
    (rowId: string, colKey: string, currentValue: string | number | null) => {
      setEditingCell({ rowId, colKey });
      setEditValue(currentValue !== null ? String(currentValue) : '');
    },
    [],
  );

  const commitEdit = useCallback(() => {
    if (!editingCell) return;
    const numVal = Number(editValue);
    const value = isNaN(numVal) ? editValue : numVal;
    onCellEdit(editingCell.rowId, editingCell.colKey, value);
    setEditingCell(null);
  }, [editingCell, editValue, onCellEdit]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') commitEdit();
      if (e.key === 'Escape') cancelEdit();
    },
    [commitEdit, cancelEdit],
  );

  if (rows.length === 0 && !loading) {
    return (
      <div className="data-grid-wrapper">
        <div className="empty-state">
          <h3>No data</h3>
          <p>Adjust your filters or select a different module.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`data-grid-wrapper ${loading ? 'loading' : ''}`}>
      <div className="data-grid-scroll">
        <table className="data-grid">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={
                    col.type === 'value'
                      ? col.format === 'text' ? 'text-col' : 'value-col'
                      : ''
                  }
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {columns.map((col) => {
                  const value = row.cells[col.key];
                  const isEditing =
                    editingCell?.rowId === row.id &&
                    editingCell?.colKey === col.key;

                  if (col.type === 'dimension') {
                    return (
                      <td key={col.key} className="dimension-cell">
                        {value ?? '—'}
                      </td>
                    );
                  }

                  if (isEditing) {
                    return (
                      <td key={col.key} className="value-cell editing">
                        <input
                          autoFocus
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={handleKeyDown}
                        />
                      </td>
                    );
                  }

                  const cellClass = col.format === 'text' ? 'text-cell' : 'value-cell';

                  return (
                    <td
                      key={col.key}
                      className={`${cellClass} ${col.editable ? 'editable' : ''}`}
                      onDoubleClick={
                        col.editable
                          ? () => startEdit(row.id, col.key, value)
                          : undefined
                      }
                    >
                      <span className={col.editable ? '' : 'cell-readonly'}>
                        {formatValue(value, col.format)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
