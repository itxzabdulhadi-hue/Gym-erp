import { withTenant } from '../../../db/index.js';
import ApiError from '../../../utils/ApiError.js';
import { paginate, pageMeta, listResponse } from '../../../utils/pagination.js';
import { memberNumber } from '../../../utils/ids.js';
import { toCsv, parseCsv } from '../../../utils/csv.js';
import { logAudit } from '../../../core/audit/audit.service.js';
import { todayISO, age, toISODate } from '../../../utils/dates.js';
import { MEMBER_STATUSES } from '@erp/shared';
import { membersRepository as repo } from './members.repository.js';

/**
 * Members - business rules.
 *
 * Owns numbering, uniqueness, status validity, the audit trail and the shape of
 * the API response. SQL lives in `members.repository.js`; HTTP in
 * `members.controller.js`.
 */

const UPDATE_COLUMNS = {
  firstName: 'first_name', lastName: 'last_name', dob: 'dob', gender: 'gender', phone: 'phone',
  email: 'email', address: 'address', city: 'city', emergencyContact: 'emergency_contact',
  emergencyPhone: 'emergency_phone', photoUrl: 'photo_url', joinDate: 'join_date',
  trainerId: 'trainer_id', status: 'status', bloodGroup: 'blood_group', occupation: 'occupation',
  notes: 'notes',
};

const IMPORT_COLUMNS = ['member_no', 'first_name', 'last_name', 'dob', 'gender', 'phone', 'email', 'address', 'join_date', 'status', 'notes'];

export async function listMembers(tenantId, q = {}) {
  const { page, limit, offset } = paginate(q);
  const { rows, total } = await withTenant(tenantId, () => repo.list(tenantId, q, { limit, offset }));
  return listResponse(rows.map(shapeMember), pageMeta({ page, limit }, total));
}

export async function getMember(tenantId, memberId) {
  const row = await withTenant(tenantId, () => repo.findById(tenantId, memberId));
  if (!row) throw ApiError.notFound('Member not found');
  return {
    ...shapeMember(row),
    notes: row.notes,
    address: row.address,
    city: row.city,
    emergencyContact: row.emergency_contact,
    emergencyPhone: row.emergency_phone,
    bloodGroup: row.blood_group,
    occupation: row.occupation,
    customFields: row.custom_fields || {},
    totalPaid: Number(row.total_paid),
    outstanding: Number(row.outstanding),
    lastProgressAt: row.last_progress_at,
  };
}

export async function createMember(tenantId, input, actor) {
  return withTenant(tenantId, async () => {
    const memberNo = input.memberNo || (await nextMemberNumber(tenantId));
    if (await repo.existsByMemberNo(tenantId, memberNo)) {
      throw ApiError.conflict(`Member number ${memberNo} is already used`);
    }
    if (input.email && (await repo.existsByEmail(tenantId, input.email))) {
      throw ApiError.conflict('A member with that email already exists');
    }
    if (input.trainerId) await assertTrainer(tenantId, input.trainerId);

    const values = {
      memberNo,
      firstName: input.firstName,
      lastName: input.lastName,
      dob: input.dob ?? null,
      gender: input.gender ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
      city: input.city ?? null,
      emergencyContact: input.emergencyContact ?? null,
      emergencyPhone: input.emergencyPhone ?? null,
      photoUrl: input.photoUrl ?? null,
      joinDate: input.joinDate || todayISO(),
      trainerId: input.trainerId ?? null,
      status: input.status || 'active',
      bloodGroup: input.bloodGroup ?? null,
      occupation: input.occupation ?? null,
      notes: input.notes ?? null,
      customFields: input.customFields || {},
    };

    const inserted = await repo.insert(tenantId, values, actor?.userId);

    await logAudit(null, {
      tenantId,
      userId: actor?.userId,
      userLabel: actor?.userLabel,
      action: 'member.created',
      entity: 'member',
      entityId: inserted.id,
      metadata: { memberNo, name: `${input.firstName} ${input.lastName}` },
    });

    return shapeMember({ ...inserted, full_name: `${input.firstName} ${input.lastName}` });
  });
}

export async function updateMember(tenantId, memberId, input, actor) {
  return withTenant(tenantId, async () => {
    const before = await repo.findRawById(tenantId, memberId);
    if (!before) throw ApiError.notFound('Member not found');
    if (input.trainerId) await assertTrainer(tenantId, input.trainerId);

    // The repository prepends $1 = tenant_id and $2 = id, so value
    // placeholders start at $3.
    const sets = [];
    const params = [];
    for (const [key, column] of Object.entries(UPDATE_COLUMNS)) {
      if (input[key] === undefined) continue;
      params.push(input[key] === '' ? null : input[key]);
      sets.push(`${column} = $${params.length + 2}`);
    }
    if (input.customFields !== undefined) {
      params.push(JSON.stringify(input.customFields));
      sets.push(`custom_fields = $${params.length + 2}::jsonb`);
    }
    if (!sets.length) throw ApiError.badRequest('Nothing to update');

    const after = await repo.update(tenantId, memberId, sets, params);

    const changes = {};
    for (const [key, column] of Object.entries(UPDATE_COLUMNS)) {
      if (input[key] !== undefined && String(before[column] ?? '') !== String(after[column] ?? '')) {
        changes[key] = { from: before[column], to: after[column] };
      }
    }

    await logAudit(null, {
      tenantId,
      userId: actor?.userId,
      userLabel: actor?.userLabel,
      action: 'member.updated',
      entity: 'member',
      entityId: memberId,
      metadata: { memberNo: before.member_no, changes },
    });

    return shapeMember({ ...after, full_name: `${after.first_name} ${after.last_name}` });
  });
}

export async function deleteMember(tenantId, memberId, actor) {
  return withTenant(tenantId, async () => {
    const current = await repo.findSummaryById(tenantId, memberId);
    if (!current) throw ApiError.notFound('Member not found');

    await repo.remove(tenantId, memberId);
    await logAudit(null, {
      tenantId,
      userId: actor?.userId,
      userLabel: actor?.userLabel,
      action: 'member.deleted',
      entity: 'member',
      entityId: memberId,
      metadata: { memberNo: current.member_no, name: `${current.first_name} ${current.last_name}` },
    });
    return { ok: true };
  });
}

/** Bulk status change (suspend / freeze / reactivate from the list view). */
export async function bulkUpdateStatus(tenantId, memberIds, status, actor) {
  if (!MEMBER_STATUSES.includes(status)) throw ApiError.badRequest('Unknown member status');
  if (!memberIds.length) throw ApiError.badRequest('No members selected');

  return withTenant(tenantId, async () => {
    const updated = await repo.bulkStatus(tenantId, memberIds, status);
    await logAudit(null, {
      tenantId,
      userId: actor?.userId,
      userLabel: actor?.userLabel,
      action: 'member.bulk_status',
      entity: 'member',
      entityId: tenantId,
      metadata: { status, count: updated },
    });
    return { updated };
  });
}

// ---------------------------------------------------------------------------
// Sub-resources used by the profile page
// ---------------------------------------------------------------------------

export const memberMemberships = (tenantId, memberId) =>
  withTenant(tenantId, () => repo.memberships(tenantId, memberId));

export const memberPayments = (tenantId, memberId, limit = 50) =>
  withTenant(tenantId, () => repo.payments(tenantId, memberId, limit));

export const memberAttendance = (tenantId, memberId, opts = {}) =>
  withTenant(tenantId, () => repo.attendance(tenantId, memberId, opts));

export const memberProgress = (tenantId, memberId) =>
  withTenant(tenantId, () => repo.progress(tenantId, memberId));

export const memberWorkouts = (tenantId, memberId) =>
  withTenant(tenantId, () => repo.workouts(tenantId, memberId));

export const memberDocuments = (tenantId, memberId) =>
  withTenant(tenantId, () => repo.documents(tenantId, memberId));

export async function attachDocument(tenantId, memberId, { fileId, label }, actor) {
  return withTenant(tenantId, async () => {
    if (!(await repo.findFile(tenantId, fileId))) throw ApiError.notFound('File not found');
    const inserted = await repo.insertDocument(tenantId, memberId, fileId, label || 'Document');
    await logAudit(null, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'member.document_added', entity: 'member', entityId: memberId,
      metadata: { label: label || 'Document' },
    });
    return inserted;
  });
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

export function importTemplateCsv() {
  return toCsv(
    [{ member_no: 'M-1001', first_name: 'Alex', last_name: 'Rivera', dob: '1994-05-12', gender: 'male', phone: '+15551234567', email: 'alex@example.com', address: '12 Main St', join_date: todayISO(), status: 'active', notes: '' }],
    IMPORT_COLUMNS.map((c) => ({ key: c, header: c })),
  );
}

/**
 * Validate then insert. Every row is checked; invalid rows are reported with
 * their line number and nothing is written for them.
 */
export async function importMembers(tenantId, csvText, actor) {
  const { rows } = parseCsv(csvText);
  if (!rows.length) throw ApiError.badRequest('The file has no data rows');
  if (rows.length > 5000) throw ApiError.badRequest('Import at most 5000 rows at a time');

  const errors = [];
  const prepared = [];

  rows.forEach((row, index) => {
    const line = row.__line || index + 2;
    const firstName = row.first_name?.trim();
    const lastName = row.last_name?.trim();
    if (!firstName || !lastName) {
      errors.push({ line, message: 'first_name and last_name are required' });
      return;
    }
    if (row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) {
      errors.push({ line, message: `"${row.email}" is not a valid email` });
      return;
    }
    if (row.dob && !/^\d{4}-\d{2}-\d{2}$/.test(row.dob)) {
      errors.push({ line, message: 'dob must be YYYY-MM-DD' });
      return;
    }
    if (row.status && !MEMBER_STATUSES.includes(row.status)) {
      errors.push({ line, message: `status must be one of ${MEMBER_STATUSES.join(', ')}` });
      return;
    }
    prepared.push({
      memberNo: row.member_no?.trim() || null,
      firstName,
      lastName,
      dob: row.dob || null,
      gender: row.gender || null,
      phone: row.phone || null,
      email: row.email || null,
      address: row.address || null,
      joinDate: row.join_date || todayISO(),
      status: row.status || 'active',
      notes: row.notes || null,
    });
  });

  if (errors.length) return { imported: 0, failed: errors.length, errors: errors.slice(0, 50) };

  const result = await withTenant(tenantId, async () => {
    let imported = 0;
    let sequence = (await repo.count(tenantId)) + 1;
    for (const row of prepared) {
      const memberNo = row.memberNo || memberNumber(sequence);
      sequence += 1;
      if (await repo.insertImported(tenantId, { ...row, memberNo }, actor?.userId)) imported += 1;
    }
    await logAudit(null, {
      tenantId, userId: actor?.userId, userLabel: actor?.userLabel,
      action: 'member.imported', entity: 'member', entityId: tenantId,
      metadata: { imported, attempted: prepared.length },
    });
    return { imported, attempted: prepared.length };
  });

  return { ...result, failed: result.attempted - result.imported, errors: [] };
}

export async function exportMembersCsv(tenantId, q = {}) {
  const rows = await withTenant(tenantId, () => repo.exportRows(tenantId, q));

  return toCsv(rows, [
    { key: 'member_no', header: 'Member No' },
    { key: 'first_name', header: 'First Name' },
    { key: 'last_name', header: 'Last Name' },
    { key: 'dob', header: 'Date of Birth' },
    { key: 'gender', header: 'Gender' },
    { key: 'phone', header: 'Phone' },
    { key: 'email', header: 'Email' },
    { key: 'address', header: 'Address' },
    { key: 'city', header: 'City' },
    { key: 'join_date', header: 'Join Date' },
    { key: 'status', header: 'Status' },
    { key: 'emergency_contact', header: 'Emergency Contact' },
    { key: 'emergency_phone', header: 'Emergency Phone' },
    { key: 'trainer', header: 'Trainer' },
    { key: 'notes', header: 'Notes' },
  ]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function nextMemberNumber(tenantId) {
  // Retry on collision so two concurrent "new member" requests cannot both win.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const sequence = await repo.count(tenantId);
    const candidate = memberNumber(sequence + attempt + 1);
    if (!(await repo.existsByMemberNo(tenantId, candidate))) return candidate;
  }
  return memberNumber(Date.now() % 1_000_000);
}

async function assertTrainer(tenantId, trainerId) {
  if (!(await repo.findTrainer(tenantId, trainerId))) {
    throw ApiError.badRequest('That trainer does not belong to this business');
  }
}

function shapeMember(row) {
  return {
    id: row.id,
    memberNo: row.member_no,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: row.full_name || `${row.first_name} ${row.last_name}`,
    dob: row.dob,
    age: age(row.dob),
    gender: row.gender,
    phone: row.phone,
    email: row.email,
    address: row.address,
    city: row.city,
    photoUrl: row.photo_url,
    joinDate: row.join_date,
    status: row.status,
    trainerId: row.trainer_id,
    trainerName: row.trainer_name,
    currentPlan: row.current_plan,
    currentPlanId: row.current_plan_id,
    currentMembershipId: row.current_membership_id,
    membershipEndDate: row.membership_end_date,
    membershipStatus: row.membership_status,
    daysRemaining: row.membership_end_date ? daysUntil(row.membership_end_date) : null,
    visits30d: Number(row.visits_30d ?? 0),
    totalVisits: Number(row.total_visits ?? 0),
    outstanding: Number(row.outstanding ?? 0),
    createdAt: row.created_at,
  };
}

function daysUntil(date) {
  return Math.round((new Date(`${toISODate(date)}T00:00:00Z`) - new Date(`${todayISO()}T00:00:00Z`)) / 86_400_000);
}
