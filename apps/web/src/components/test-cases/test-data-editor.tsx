'use client';
import { Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface TestDataDraft {
  columns: string[];
  rows: string[][];
}

/** Parameterised test data: the case runs once per row. */
export function TestDataEditor({
  value,
  onChange,
  editable,
}: {
  value: TestDataDraft | null;
  onChange: (v: TestDataDraft | null) => void;
  editable: boolean;
}) {
  if (!value) {
    return editable ? (
      <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
        Run the same steps with different inputs?{' '}
        <button
          className="font-medium text-primary hover:underline"
          onClick={() => onChange({ columns: ['input'], rows: [['']] })}
        >
          Add a data table
        </button>
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">No test data.</p>
    );
  }
  const { columns, rows } = value;
  const setCol = (i: number, name: string) =>
    onChange({ columns: columns.map((c, j) => (j === i ? name : c)), rows });
  const setCell = (r: number, c: number, v: string) =>
    onChange({
      columns,
      rows: rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)),
    });
  const addCol = () =>
    onChange({
      columns: [...columns, `param${columns.length + 1}`],
      rows: rows.map((r) => [...r, '']),
    });
  const removeCol = (i: number) =>
    columns.length === 1
      ? onChange(null)
      : onChange({
          columns: columns.filter((_, j) => j !== i),
          rows: rows.map((r) => r.filter((_, j) => j !== i)),
        });
  const cell =
    'h-8 w-full min-w-28 bg-transparent px-2 text-sm outline-none focus:bg-accent/50 read-only:cursor-default';

  return (
    <div className="grid gap-2">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="w-8 border-r px-2 text-xs font-medium text-muted-foreground">#</th>
              {columns.map((c, i) => (
                <th key={i} className="border-r last:border-r-0">
                  <div className="flex items-center">
                    <input
                      className={`${cell} font-mono font-medium`}
                      value={c}
                      readOnly={!editable}
                      onChange={(e) => setCol(i, e.target.value)}
                      aria-label={`Column ${i + 1} name`}
                    />
                    {editable && (
                      <button
                        className="p-1 text-muted-foreground hover:text-destructive"
                        onClick={() => removeCol(i)}
                        aria-label={`Remove column ${c}`}
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                </th>
              ))}
              {editable && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-t">
                <td className="border-r text-center text-xs text-muted-foreground tabular-nums">
                  {r + 1}
                </td>
                {row.map((v, c) => (
                  <td key={c} className="border-r last:border-r-0">
                    <input
                      className={cell}
                      value={v}
                      readOnly={!editable}
                      onChange={(e) => setCell(r, c, e.target.value)}
                      aria-label={`Row ${r + 1}, ${columns[c]}`}
                    />
                  </td>
                ))}
                {editable && (
                  <td>
                    <button
                      className="p-1 text-muted-foreground hover:text-destructive"
                      onClick={() => onChange({ columns, rows: rows.filter((_, i) => i !== r) })}
                      aria-label={`Remove row ${r + 1}`}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onChange({ columns, rows: [...rows, columns.map(() => '')] })}
          >
            <Plus /> Row
          </Button>
          <Button size="sm" variant="outline" onClick={addCol}>
            <Plus /> Column
          </Button>
        </div>
      )}
    </div>
  );
}
