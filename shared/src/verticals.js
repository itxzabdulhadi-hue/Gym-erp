/**
 * Verticals = products built on top of the platform.
 *
 * A vertical declares which modules it ships with and what its entities are
 * called. "Gym" is the first implemented vertical; the rest are declared so the
 * onboarding flow, module registry and terminology service are already shaped
 * for them (they are explicitly marked as unavailable until built).
 */
export const VERTICALS = [
  {
    key: 'gym',
    label: 'Gym & Fitness',
    available: true,
    description: 'Members, memberships, attendance, trainers, workouts and billing.',
    terminology: {
      customer: 'Member',
      customerPlural: 'Members',
      staff: 'Trainer',
      staffPlural: 'Trainers',
      subscription: 'Membership',
      subscriptionPlural: 'Memberships',
      visit: 'Check-in',
      visitPlural: 'Check-ins',
      location: 'Gym',
    },
    defaultModules: [
      'dashboard', 'members', 'memberships', 'attendance', 'trainers', 'workouts',
      'progress', 'payments', 'expenses', 'reports',
      'users', 'roles', 'notifications', 'audit', 'settings',
    ],
  },
  {
    key: 'salon',
    label: 'Salon & Spa',
    available: false,
    description: 'Appointments, stylists, services and packages.',
    terminology: {
      customer: 'Client', customerPlural: 'Clients', staff: 'Stylist', staffPlural: 'Stylists',
      subscription: 'Package', subscriptionPlural: 'Packages', visit: 'Appointment',
      visitPlural: 'Appointments', location: 'Salon',
    },
    defaultModules: ['dashboard', 'members', 'memberships', 'attendance', 'trainers', 'payments', 'expenses', 'reports', 'users', 'roles', 'notifications', 'audit', 'settings'],
  },
  {
    key: 'clinic',
    label: 'Clinic & Medical',
    available: false,
    description: 'Patients, practitioners, appointments and records.',
    terminology: {
      customer: 'Patient', customerPlural: 'Patients', staff: 'Practitioner', staffPlural: 'Practitioners',
      subscription: 'Care plan', subscriptionPlural: 'Care plans', visit: 'Appointment',
      visitPlural: 'Appointments', location: 'Clinic',
    },
    defaultModules: ['dashboard', 'members', 'memberships', 'attendance', 'trainers', 'payments', 'expenses', 'reports', 'users', 'roles', 'notifications', 'audit', 'settings'],
  },
  {
    key: 'school',
    label: 'School & Academy',
    available: false,
    description: 'Students, courses, attendance and fees.',
    terminology: {
      customer: 'Student', customerPlural: 'Students', staff: 'Teacher', staffPlural: 'Teachers',
      subscription: 'Course', subscriptionPlural: 'Courses', visit: 'Attendance',
      visitPlural: 'Attendance', location: 'Campus',
    },
    defaultModules: ['dashboard', 'members', 'memberships', 'attendance', 'trainers', 'payments', 'expenses', 'reports', 'users', 'roles', 'notifications', 'audit', 'settings'],
  },
];

export const DEFAULT_VERTICAL = 'gym';

export function getVertical(key) {
  return VERTICALS.find((v) => v.key === key) || null;
}

/**
 * Resolve a display term for a tenant, falling back to the vertical default and
 * then to a neutral label. Used everywhere the UI needs to say "Member".
 */
export function term(vertical, key, fallback = '') {
  const v = getVertical(vertical);
  return (v && v.terminology[key]) || fallback || key;
}
