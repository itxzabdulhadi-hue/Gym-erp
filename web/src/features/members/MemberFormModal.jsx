import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GENDERS, MEMBER_STATUSES } from '@erp/shared';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import trainersApi from '@/services/trainers.api';
import { queryKeys } from '@/lib/queryClient';
import { useCreateMember, useUpdateMember } from './useMembers';
import { terminologyFor } from '@/services/branding.api';
import { useAuth } from '@/contexts/AuthContext';
import { todayISO } from '@/lib/format';

/**
 * Create / edit member.
 *
 * Validation is two-layered on purpose: the obvious checks run here so the
 * user is not waiting on a round trip, and the server's verdict is authoritative
 * - its 422 details are mapped back onto the exact fields, so a rule the client
 * does not know about still surfaces in the right place.
 */

const EMPTY = {
  firstName: '',
  lastName: '',
  dob: '',
  gender: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  emergencyContact: '',
  emergencyPhone: '',
  joinDate: '',
  trainerId: '',
  status: 'active',
  bloodGroup: '',
  occupation: '',
  notes: '',
};

function toForm(member) {
  if (!member) return { ...EMPTY, joinDate: todayISO() };
  return {
    ...EMPTY,
    ...Object.fromEntries(
      Object.keys(EMPTY).map((key) => [key, member[key] === null || member[key] === undefined ? '' : member[key]]),
    ),
    joinDate: member.joinDate ? String(member.joinDate).slice(0, 10) : '',
    dob: member.dob ? String(member.dob).slice(0, 10) : '',
  };
}

/** Empty strings must not be sent - the API distinguishes null from ''. */
function toPayload(form) {
  const out = {};
  for (const [key, value] of Object.entries(form)) {
    if (key === 'trainerId') {
      out.trainerId = value || null;
      continue;
    }
    out[key] = value === '' ? null : value;
  }
  return out;
}

export function MemberFormModal({ open, onClose, member }) {
  const isEdit = !!member;
  const { branding } = useAuth();
  const terms = useMemo(() => terminologyFor(branding), [branding]);
  const toast = useToast();

  const [form, setForm] = useState(() => toForm(member));
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (open) {
      setForm(toForm(member));
      setErrors({});
    }
  }, [open, member]);

  const { data: trainers } = useQuery({
    queryKey: queryKeys.trainers({ limit: 100 }),
    queryFn: () => trainersApi.list({ limit: 100 }),
    enabled: open,
  });

  const create = useCreateMember();
  const update = useUpdateMember();
  const mutation = isEdit ? update : create;

  const set = (key) => (event) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const validate = () => {
    const next = {};
    if (!form.firstName.trim()) next.firstName = 'First name is required';
    if (!form.lastName.trim()) next.lastName = 'Last name is required';
    if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) next.email = 'Enter a valid email address';
    if (form.joinDate && !/^\d{4}-\d{2}-\d{2}$/.test(form.joinDate)) next.joinDate = 'Use YYYY-MM-DD';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!validate()) return;

    try {
      const payload = toPayload(form);
      if (isEdit) {
        await update.mutateAsync({ id: member.id, patch: payload });
        toast.success(`${terms.customer} updated`, `${payload.firstName} ${payload.lastName}`);
      } else {
        await create.mutateAsync(payload);
        toast.success(`${terms.customer} added`, `${payload.firstName} ${payload.lastName}`);
      }
      onClose?.();
    } catch (error) {
      if (error?.isValidation) {
        setErrors(error.fieldErrors());
        setErrors((prev) => ({ ...prev, form: error.message }));
      } else {
        setErrors({ form: error?.message || 'Could not save. Please try again.' });
      }
    }
  };

  const trainerList = trainers?.data || trainers || [];

  return (
    <Modal
      open={open}
      onClose={mutation.isPending ? undefined : onClose}
      title={isEdit ? `Edit ${terms.customer.toLowerCase()}` : `Add ${terms.customer.toLowerCase()}`}
      description={isEdit ? member?.memberNo : 'Details can be completed later.'}
      size="lg"
      closeOnBackdrop={!mutation.isPending}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={mutation.isPending}>
            {isEdit ? 'Save changes' : `Add ${terms.customer.toLowerCase()}`}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {errors.form && (
          <p role="alert" className="rounded bg-danger-soft px-3 py-2.5 text-xs text-danger">
            {errors.form}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="firstName" error={errors.firstName} required>
            <Input id="firstName" value={form.firstName} onChange={set('firstName')} autoComplete="off" invalid={!!errors.firstName} />
          </Field>
          <Field label="Last name" htmlFor="lastName" error={errors.lastName} required>
            <Input id="lastName" value={form.lastName} onChange={set('lastName')} autoComplete="off" invalid={!!errors.lastName} />
          </Field>
          <Field label="Email" htmlFor="email" error={errors.email}>
            <Input id="email" type="email" value={form.email} onChange={set('email')} autoComplete="off" invalid={!!errors.email} />
          </Field>
          <Field label="Phone" htmlFor="phone" error={errors.phone}>
            <Input id="phone" type="tel" value={form.phone} onChange={set('phone')} autoComplete="off" invalid={!!errors.phone} />
          </Field>
          <Field label="Date of birth" htmlFor="dob" error={errors.dob}>
            <Input id="dob" type="date" value={form.dob} onChange={set('dob')} invalid={!!errors.dob} />
          </Field>
          <Field label="Gender" htmlFor="gender">
            <Select id="gender" value={form.gender} onChange={set('gender')}>
              <option value="">Not specified</option>
              {GENDERS.map((gender) => (
                <option key={gender} value={gender}>
                  {gender.charAt(0).toUpperCase() + gender.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Join date" htmlFor="joinDate" error={errors.joinDate}>
            <Input id="joinDate" type="date" value={form.joinDate} onChange={set('joinDate')} invalid={!!errors.joinDate} />
          </Field>
          <Field label="Status" htmlFor="status">
            <Select id="status" value={form.status} onChange={set('status')}>
              {MEMBER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={terms.staff} htmlFor="trainerId" error={errors.trainerId}>
            <Select id="trainerId" value={form.trainerId} onChange={set('trainerId')}>
              <option value="">Unassigned</option>
              {(Array.isArray(trainerList) ? trainerList : []).map((trainer) => (
                <option key={trainer.id} value={trainer.id}>
                  {trainer.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Blood group" htmlFor="bloodGroup">
            <Input id="bloodGroup" value={form.bloodGroup} onChange={set('bloodGroup')} maxLength={10} />
          </Field>
          <Field label="Address" htmlFor="address" className="sm:col-span-2">
            <Input id="address" value={form.address} onChange={set('address')} />
          </Field>
          <Field label="City" htmlFor="city">
            <Input id="city" value={form.city} onChange={set('city')} />
          </Field>
          <Field label="Occupation" htmlFor="occupation">
            <Input id="occupation" value={form.occupation} onChange={set('occupation')} />
          </Field>
          <Field label="Emergency contact" htmlFor="emergencyContact">
            <Input id="emergencyContact" value={form.emergencyContact} onChange={set('emergencyContact')} />
          </Field>
          <Field label="Emergency phone" htmlFor="emergencyPhone">
            <Input id="emergencyPhone" type="tel" value={form.emergencyPhone} onChange={set('emergencyPhone')} />
          </Field>
          <Field label="Notes" htmlFor="notes" className="sm:col-span-2">
            <Textarea id="notes" value={form.notes} onChange={set('notes')} rows={3} />
          </Field>
        </div>

        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

export default MemberFormModal;
