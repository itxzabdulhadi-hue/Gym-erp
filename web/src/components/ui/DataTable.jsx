import { cn } from '@/lib/cn';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { TableSkeleton, EmptyState, ErrorState } from './States';
import { Pagination } from './Pagination';

/**
 * Data table.
 *
 * One component, two presentations: a real <table> with sticky header on
 * desktop, and a stacked card list below `md`. A desktop table squeezed into
 * 320px is unreadable, and a horizontal scroller hides the columns that matter,
 * so the mobile view re-renders the same rows as labelled cards instead.
 *
 * `columns` entries: { key, header, cell?, sortable?, align?, hideOnMobile?,
 * primary? } - `primary` marks the field shown as the card title.
 */
export function DataTable({
  columns,
  rows,
  loading,
  error,
  onRetry,
  empty,
  rowKey = (row) => row.id,
  onRowClick,
  sort,
  order,
  onSortChange,
  page,
  limit,
  total,
  onPageChange,
  footer,
  selectable,
  selected = [],
  onSelectedChange,
  tableStyle = 'plain',
  className,
  emptyIcon,
  emptyAction,
}) {
  if (loading) {
    return (
      <div className={cn('card overflow-hidden', className)}>
        <TableSkeleton rows={Math.min(8, limit || 8)} columns={Math.min(columns.length, 5)} />
      </div>
    );
  }

  if (error) {
    return <ErrorState error={error} onRetry={onRetry} className={className} />;
  }

  if (!rows?.length) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={empty?.title || 'Nothing here yet'}
        description={empty?.description}
        action={empty?.action || emptyAction}
        className={className}
      />
    );
  }

  const sortableColumns = columns.filter((c) => c.sortable);
  const allSelected = selectable && selected.length === rows.length && rows.length > 0;

  const toggleAll = () => {
    if (!onSelectedChange) return;
    onSelectedChange(allSelected ? [] : rows.map(rowKey));
  };

  const toggleOne = (key) => {
    if (!onSelectedChange) return;
    onSelectedChange(
      selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key],
    );
  };

  const sortIcon = (key) => {
    if (sort !== key) return <ChevronsUpDown className="h-3 w-3 opacity-45" />;
    return order === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />;
  };

  const headerFor = (column) =>
    column.sortable && onSortChange ? (
      <button
        type="button"
        onClick={() => onSortChange(column.key, sort === column.key && order === 'asc' ? 'desc' : 'asc')}
        className={cn(
          'inline-flex items-center gap-1 font-semibold transition-colors hover:text-foreground',
          sort === column.key && 'text-foreground',
        )}
        aria-label={`Sort by ${column.header}`}
      >
        {column.header}
        {sortIcon(column.key)}
      </button>
    ) : (
      column.header
    );

  const striped = tableStyle === 'striped';
  const bordered = tableStyle === 'bordered';

  return (
    <div className={cn('card overflow-hidden', className)}>
      {/* ------------------------------ Desktop ----------------------------- */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface-alt">
            <tr>
              {selectable && (
                <th scope="col" className="w-10 border-b border-border px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all rows"
                    className="h-4 w-4 cursor-pointer rounded border-border accent-[var(--color-primary)]"
                  />
                </th>
              )}
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    'whitespace-nowrap border-b border-border px-3 py-2.5 text-left text-xs text-muted',
                    column.align === 'right' && 'text-right',
                    column.align === 'center' && 'text-center',
                    bordered && 'border-r border-border last:border-r-0',
                  )}
                >
                  {headerFor(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const key = rowKey(row);
              const isSelected = selected.includes(key);
              return (
                <tr
                  key={key}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'group transition-colors',
                    striped && rowIndex % 2 === 1 && 'bg-surface-alt',
                    isSelected && 'bg-primary-soft',
                    onRowClick && 'cursor-pointer hover:bg-surface-alt',
                  )}
                >
                  {selectable && (
                    <td className="border-b border-border px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(key)}
                        onClick={(event) => event.stopPropagation()}
                        aria-label="Select row"
                        className="h-4 w-4 cursor-pointer rounded border-border accent-[var(--color-primary)]"
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        'border-b border-border px-3 py-2.5 align-middle text-foreground',
                        column.align === 'right' && 'text-right',
                        column.align === 'center' && 'text-center',
                        column.wrap ? 'whitespace-normal' : 'whitespace-nowrap',
                        bordered && 'border-r border-border last:border-r-0',
                      )}
                    >
                      {column.cell ? column.cell(row, rowIndex) : row[column.key] ?? '—'}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ------------------------------ Mobile ------------------------------ */}
      <ul className="divide-y divide-border md:hidden">
        {rows.map((row) => {
          const key = rowKey(row);
          const primary = columns.find((c) => c.primary) || columns[0];
          const secondary = columns.filter((c) => c !== primary && !c.hideOnMobile);
          return (
            <li
              key={key}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'p-3.5 transition-colors',
                selected.includes(key) && 'bg-primary-soft',
                onRowClick && 'cursor-pointer active:bg-surface-alt',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">
                    {primary.cell ? primary.cell(row) : row[primary.key] ?? '—'}
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                    {secondary.map((column) => (
                      <div key={column.key} className="min-w-0">
                        <dt className="text-[0.6875rem] uppercase tracking-wide text-muted">{column.header}</dt>
                        <dd className="truncate text-sm text-foreground">
                          {column.cell ? column.cell(row) : row[column.key] ?? '—'}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
                {selectable && (
                  <input
                    type="checkbox"
                    checked={selected.includes(key)}
                    onChange={() => toggleOne(key)}
                    onClick={(event) => event.stopPropagation()}
                    aria-label="Select row"
                    className="mt-0.5 h-4.5 w-4.5 shrink-0 cursor-pointer rounded border-border accent-[var(--color-primary)]"
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {footer}

      {onPageChange && total !== undefined && (
        <Pagination page={page} limit={limit} total={total} onPageChange={onPageChange} />
      )}
    </div>
  );
}

export default DataTable;
