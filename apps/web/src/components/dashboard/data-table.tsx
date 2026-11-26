// A table that turns into stacked cards when there is little room (a phone, or a narrow
// card). It stays one table in the page, so nothing is there twice; the roles keep it a
// table for screen readers when the styles change how it is laid out.
import { cn } from "cn";
import type { ReactNode } from "react";

export interface Column<Row> {
  id: string;
  header: string;
  cell: (row: Row) => ReactNode;
  /** Never broken over two lines: ticket numbers and plates. */
  nowrap?: boolean;
  /** The buttons: on a card they get a full line, without the column's name. */
  actions?: boolean;
}

export function DataTable<Row>({
  label,
  columns,
  rows,
  rowKey,
}: {
  label: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string | number;
}) {
  return (
    <div className="@container">
      <table role="table" aria-label={label} className="block w-full text-left text-sm @2xl:table">
        <thead role="rowgroup" className="sr-only @2xl:not-sr-only @2xl:table-header-group">
          <tr role="row" className="@2xl:table-row">
            {columns.map((column) => (
              <th
                key={column.id}
                role="columnheader"
                scope="col"
                className="bg-muted px-2.5 py-2.5 font-semibold text-muted-foreground @2xl:first:rounded-l-lg @2xl:last:rounded-r-lg"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup" className="flex flex-col gap-3 @2xl:table-row-group">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              role="row"
              className="flex flex-col gap-2 rounded-xl border border-border p-3 @2xl:table-row"
            >
              {columns.map((column) => (
                <td
                  key={column.id}
                  role="cell"
                  className={cn(
                    "flex items-center justify-between gap-3 @2xl:table-cell @2xl:border-b @2xl:border-border @2xl:px-2.5 @2xl:py-2.5 @2xl:align-middle",
                    column.actions && "pt-1",
                  )}
                >
                  {!column.actions && (
                    <span aria-hidden className="text-muted-foreground @2xl:hidden">
                      {column.header}
                    </span>
                  )}
                  <span
                    className={cn(
                      "text-right font-medium @2xl:text-left",
                      column.nowrap && "whitespace-nowrap",
                      column.actions &&
                        "flex w-full gap-2 *:flex-1 @2xl:w-auto @2xl:justify-end @2xl:*:flex-none",
                    )}
                  >
                    {column.cell(row)}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
