import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MEMBER_STATUSES } from '@erp/shared';
import { Download, Filter, Plus, Search, Users, X } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { DataTable } from '@/components/ui/DataTable';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { useDebounced } from '@/hooks/useDebounced';
import { money, formatDate, plainNumber } from '@/lib/format';
import { terminologyFor } from '@/services/branding.api';
import membersApi from '@/services/members.api';
import trainersApi from '@/services/trainers.api';
import membershipsApi from '@/services/memberships.api';
import { queryKeys } from '@/lib/queryClient';
import { MemberFormModal } from './MemberFormModal';
import { useBulkMemberStatus, useDeleteMember, useMembers } from './useMembers';

/**
 * Members list.
 *
 * Search, filters, sorting and paging are all applied by the API - the client
 * sends parameters and renders what comes back, so the list is correct at
 * 39 members and at 39,000 without a change here.
 */

const PAGE_SIZE = 20;

export function MembersPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { branding, can } = useAuth();
  const terms = useMemo(() => terminologyFor(branding), [branding]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [trainerId, setTrainerId] = useState('');
  const [planId, setPlanId] = useState('');
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [sort, setSort] = useState('created_at');
  const [order, setOrder] = useState('desc');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showFilters, setShowFilters] = useState(false);

  const debouncedSearch = useDebounced(search);

  // Any filter change is a new question, so it starts from page one.
  useEffect(() => {
    setPage(1);
    setSelected([]);
  }, [debouncedSearch, status, trainerId, planId, expiringOnly, sort, order]);

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      status: status || undefined,
      trainerId: trainerId || undefined,
      planId: planId || undefined,
      expiringWithinDays: expiringOnly ? 7 : undefined,
      sort,
      order,
      page,
      limit: PAGE_SIZE,
    }),
    [debouncedSearch, status, trainerId, planId, expiringOnly, sort, order, page],
  );

  const { data, isLoading, error, refetch, isFetching } = useMembers(params);
  const rows = data?.data || [];
  const meta = data?.meta;

  const { data: trainers } = useQuery({
    queryKey: queryKeys.trainers({ limit: 100 }),
    queryFn: () => trainersApi.list({ limit: 100 }),
    staleTime: 5 * 60_000,
  });
  const { data: plans } = useQuery({
    queryKey: queryKeys.plans({ activeOnly: true }),
    queryFn: () => membershipsApi.plans.list({ activeOnly: true }),
    staleTime: 5 * 60_000,
  });

  const bulkStatus = useBulkMemberStatus();
  const removeMember = useDeleteMember();

  const trainerList = Array.isArray(trainers?.data) ? trainers.data : Array.isArray(trainers) ? trainers : [];
  const planList = Array.isArray(plans?.data) ? plans.data : Array.isArray(plans) ? plans : [];

  const activeFilters = [status, trainerId, planId, expiringOnly ? 'expiring' : ''].filter(Boolean).length;

  const clearFilters = () => {
    setStatus('');
    setTrainerId('');
    setPlanId('');
    setExpiringOnly(false);
    setSearch('');
  };

  const onSortChange = (key, direction) => {
    setSort(key);
    setOrder(direction);
  };

  const handleBulkStatus = async (nextStatus) => {
    try {
      const result = await bulkStatus.mutateAsync({ ids: selected, status: nextStatus });
      toast.success('Status updated', `${plainNumber(result.updated)} ${terms.customerPlural.toLowerCase()} set to ${nextStatus}.`);
      setSelected([]);
    } catch (err) {
      toast.error('Could not update status', err.message);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await removeMember.mutateAsync(confirmDelete.id);
      toast.success(`${terms.customer} deleted`, `${confirmDelete.fullName} was removed.`);
      setConfirmDelete(null);
    } catch (err) {
      toast.error('Could not delete', err.message);
    }
  };

  const handleExport = async () => {
    try {
      await membersApi.exportCsv({ ...params, limit: undefined, page: undefined });
      toast.success('Export started', 'Your CSV is downloading.');
    } catch (err) {
      toast.error('Export failed', err.message);
    }
  };

  const columns = useMemo(
    () => [
      {
        key: 'fullName',
        header: terms.customer,
        primary: true,
        sortable: true,
        cell: (row) => (
          <div className="flex items-center gap-2.5">
            <Avatar src={row.photoUrl} name={row.fullName} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{row.fullName}</p>
              <p className="truncate text-xs text-muted">{row.memberNo}</p>
            </div>
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        cell: (row) => <StatusBadge status={row.status} />,
      },
      {
        key: 'currentPlan',
        header: terms.subscription,
        cell: (row) =>
          row.currentPlan ? (
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">{row.currentPlan}</p>
              <p className="text-xs text-muted">
                {row.membershipEndDate ? formatDate(row.membershipEndDate) : 'No end date'}
              </p>
            </div>
          ) : (
            <span className="text-xs text-muted">None</span>
          ),
      },
      {
        key: 'daysRemaining',
        header: 'Expires in',
        align: 'right',
        cell: (row) => {
          if (row.daysRemaining === null || row.daysRemaining === undefined) return '—';
          if (row.daysRemaining < 0) return <span className="text-xs font-medium text-danger">Expired</span>;
          const tone = row.daysRemaining <= 7 ? 'text-warning' : 'text-muted';
          return <span className={`text-xs font-medium ${tone}`}>{row.daysRemaining}d</span>;
        },
      },
      {
        key: 'phone',
        header: 'Contact',
        hideOnMobile: true,
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate text-sm text-foreground">{row.phone || '—'}</p>
            <p className="truncate text-xs text-muted">{row.email || ''}</p>
          </div>
        ),
      },
      {
        key: 'trainerName',
        header: terms.staff,
        hideOnMobile: true,
        cell: (row) => <span className="text-sm text-foreground">{row.trainerName || '—'}</span>,
      },
      {
        key: 'visits30d',
        header: `${terms.visitPlural} (30d)`,
        align: 'right',
        hideOnMobile: true,
        cell: (row) => <span className="text-sm text-foreground">{plainNumber(row.visits30d)}</span>,
      },
      {
        key: 'outstanding',
        header: 'Outstanding',
        align: 'right',
        cell: (row) =>
          Number(row.outstanding) > 0 ? (
            <span className="text-sm font-medium text-danger">{money(row.outstanding, branding)}</span>
          ) : (
            <span className="text-xs text-muted">—</span>
          ),
      },
      {
        key: 'joinDate',
        header: 'Joined',
        sortable: true,
        hideOnMobile: true,
        cell: (row) => <span className="text-sm text-muted">{formatDate(row.joinDate)}</span>,
      },
      ...(can('members.delete')
        ? [
            {
              key: 'actions',
              header: '',
              align: 'right',
              hideOnMobile: true,
              cell: (row) => (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={(event) => {
                    event.stopPropagation();
                    setConfirmDelete(row);
                  }}
                >
                  Delete
                </Button>
              ),
            },
          ]
        : []),
    ],
    [terms, branding, can],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={terms.customerPlural}
        description={
          meta ? `${plainNumber(meta.total)} total` : `Manage your ${terms.customerPlural.toLowerCase()}`
        }
        actions={
          <>
            {can('members.export') && (
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
            )}
            {can('members.create') && (
              <Button size="sm" onClick={() => setFormOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                Add {terms.customer.toLowerCase()}
              </Button>
            )}
          </>
        }
      />

      {/* ------------------------------ Filters ------------------------------ */}
      <div className="card space-y-3 p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search by name, ${terms.customer.toLowerCase()} number, email or phone`}
              aria-label={`Search ${terms.customerPlural.toLowerCase()}`}
              className="pl-9"
            />
          </div>
          <div className="flex gap-2">
            <Select
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              aria-label="Sort by"
              className="sm:w-44"
            >
              <option value="created_at">Newest first</option>
              <option value="name">Name</option>
              <option value="join_date">Join date</option>
              <option value="status">Status</option>
              <option value="member_no">{terms.customer} number</option>
            </Select>
            <Button
              variant={showFilters || activeFilters ? 'soft' : 'outline'}
              size="md"
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
            >
              <Filter className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Filters</span>
              {activeFilters > 0 && (
                <span className="grid h-4.5 min-w-4.5 place-items-center rounded-full bg-primary px-1 text-[0.625rem] font-bold text-primary-fg">
                  {activeFilters}
                </span>
              )}
            </Button>
          </div>
        </div>

        {(showFilters || activeFilters > 0) && (
          <div className="grid gap-2 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status">
              <option value="">All statuses</option>
              {MEMBER_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value.charAt(0).toUpperCase() + value.slice(1)}
                </option>
              ))}
            </Select>

            <Select value={trainerId} onChange={(event) => setTrainerId(event.target.value)} aria-label={terms.staff}>
              <option value="">All {terms.staffPlural.toLowerCase()}</option>
              {trainerList.map((trainer) => (
                <option key={trainer.id} value={trainer.id}>
                  {trainer.fullName}
                </option>
              ))}
            </Select>

            <Select value={planId} onChange={(event) => setPlanId(event.target.value)} aria-label={terms.subscription}>
              <option value="">All {terms.subscriptionPlural.toLowerCase()}</option>
              {planList.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </Select>

            <label className="flex h-9.5 cursor-pointer items-center gap-2 rounded border border-border bg-input px-3 text-sm text-foreground">
              <input
                type="checkbox"
                checked={expiringOnly}
                onChange={(event) => setExpiringOnly(event.target.checked)}
                className="h-4 w-4 cursor-pointer rounded border-border accent-[var(--color-primary)]"
              />
              Expiring within 7 days
            </label>

            {activeFilters > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="flex items-center gap-1 text-xs font-medium text-primary hover:underline sm:col-span-2 lg:col-span-4"
              >
                <X className="h-3 w-3" />
                Clear all filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* --------------------------- Bulk action bar ------------------------- */}
      {selected.length > 0 && can('members.edit') && (
        <div className="card flex flex-wrap items-center gap-2 border-primary bg-primary-soft p-2.5">
          <p className="text-sm font-medium text-primary">
            {plainNumber(selected.length)} selected
          </p>
          <div className="ml-auto flex flex-wrap gap-2">
            {['active', 'frozen', 'suspended', 'inactive'].map((value) => (
              <Button
                key={value}
                variant="outline"
                size="xs"
                loading={bulkStatus.isPending}
                onClick={() => handleBulkStatus(value)}
              >
                Mark {value}
              </Button>
            ))}
            <Button variant="ghost" size="xs" onClick={() => setSelected([])}>
              Clear
            </Button>
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        loading={isLoading}
        error={error}
        onRetry={() => refetch()}
        rowKey={(row) => row.id}
        onRowClick={(row) => navigate(`/members/${row.id}`)}
        sort={sort}
        order={order}
        onSortChange={onSortChange}
        page={page}
        limit={PAGE_SIZE}
        total={meta?.total}
        onPageChange={setPage}
        selectable={can('members.edit')}
        selected={selected}
        onSelectedChange={setSelected}
        emptyIcon={Users}
        empty={{
          title: activeFilters || debouncedSearch ? 'No matching members' : `No ${terms.customerPlural.toLowerCase()} yet`,
          description: activeFilters || debouncedSearch
            ? 'Try a different search term or clear the filters.'
            : `Add your first ${terms.customer.toLowerCase()} to get started.`,
          action:
            can('members.create') && !activeFilters && !debouncedSearch ? (
              <Button size="sm" onClick={() => setFormOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                Add {terms.customer.toLowerCase()}
              </Button>
            ) : activeFilters ? (
              <Button size="sm" variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null,
        }}
      />

      {isFetching && !isLoading && (
        <p className="text-center text-xs text-muted" aria-live="polite">
          Updating…
        </p>
      )}

      {can('members.create') || can('members.edit') ? (
        <MemberFormModal open={formOpen} onClose={() => setFormOpen(false)} member={null} />
      ) : null}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        loading={removeMember.isPending}
        title={`Delete ${terms.customer.toLowerCase()}?`}
        description={
          confirmDelete
            ? `${confirmDelete.fullName} (${confirmDelete.memberNo}) and their linked records will be permanently removed. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete permanently"
      />
    </div>
  );
}

export default MembersPage;
