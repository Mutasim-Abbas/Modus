import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface ChartTableSpec {
  /** Read by screen readers only — the table's own accessible name. */
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}

interface ChartFigureProps {
  /** One-sentence, data-derived summary — the text alternative to the visual (docs/DESIGN.md §4.3). */
  caption: string;
  table: ChartTableSpec;
  /** The SVG/visual. Rendered inside an `aria-hidden` wrapper — nothing here is read by AT. */
  visual: ReactNode;
  /** Optional visible legend/notes below the visual — NOT aria-hidden. */
  legend?: ReactNode;
}

/**
 * Wraps every chart in the accessible pattern docs/DESIGN.md §4.3 mandates for all of
 * them: the drawing itself is decorative (`aria-hidden`), a one-sentence `<figcaption>`
 * states the trend in words, and a "Show data table" disclosure reveals a real
 * `<table>` with the same numbers — the actual text alternative, not alt text.
 *
 * `forced-colors: active` (Windows High Contrast) auto-expands the table, per §4.3.5.
 */
export function ChartFigure({ caption, table, visual, legend }: ChartFigureProps): JSX.Element {
  const [forcedColorsOpen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(forced-colors: active)').matches,
  );

  return (
    <figure className="m-0 flex flex-col gap-2">
      <div aria-hidden="true">{visual}</div>
      {legend}
      <figcaption className="text-xs leading-relaxed text-fm-text-subtle">{caption}</figcaption>

      <details open={forcedColorsOpen} className="group">
        <summary
          className={cn(
            'inline-flex min-h-[36px] cursor-pointer select-none list-none items-center gap-1',
            'text-xs font-semibold text-fm-text-subtle transition-colors hover:text-fm-text',
          )}
        >
          <ChevronDown
            size={14}
            aria-hidden="true"
            className="shrink-0 transition-transform duration-200 group-open:rotate-180"
          />
          Show data table
        </summary>

        <div className="mt-2 overflow-x-auto rounded-md border border-[color:var(--fm-border)]">
          <table className="w-full min-w-max text-start text-xs tabular-nums">
            <caption className="sr-only">{table.caption}</caption>
            <thead>
              <tr className="border-b border-[color:var(--fm-border)] bg-fm-bg-elevated">
                {table.columns.map((column) => (
                  <th key={column} scope="col" className="px-3 py-2 text-start font-semibold text-fm-text-subtle">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Rows have no natural id — the table is rebuilt whole on every data
                  change, never reordered in place, so an index key is safe here. */}
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-[color:var(--fm-border)] last:border-0">
                  {row.map((cell, cellIndex) =>
                    cellIndex === 0 ? (
                      <th key={cellIndex} scope="row" className="px-3 py-1.5 text-start font-semibold text-fm-text">
                        {cell}
                      </th>
                    ) : (
                      <td key={cellIndex} className="px-3 py-1.5 text-fm-text-muted">
                        {cell}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
