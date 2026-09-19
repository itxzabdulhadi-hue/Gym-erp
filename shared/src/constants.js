/**
 * Domain enums + constants shared by API and client so that validation,
 * filters and UI labels can never drift apart.
 */

export const MEMBER_STATUSES = ['active', 'inactive', 'expired', 'frozen', 'suspended'];
export const MEMBER_STATUS_LABELS = {
  active: 'Active',
  inactive: 'Inactive',
  expired: 'Expired',
  frozen: 'Frozen',
  suspended: 'Suspended',
};

export const GENDERS = ['male', 'female', 'other', 'unspecified'];

export const MEMBERSHIP_STATUSES = ['active', 'frozen', 'cancelled', 'expired'];
export const MEMBERSHIP_STATUS_LABELS = {
  active: 'Active',
  frozen: 'Frozen',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export const BILLING_CYCLES = [
  { key: 'monthly', label: 'Monthly', days: 30 },
  { key: 'quarterly', label: 'Quarterly', days: 90 },
  { key: 'half_yearly', label: 'Half yearly', days: 182 },
  { key: 'yearly', label: 'Yearly', days: 365 },
  { key: 'custom', label: 'Custom', days: null },
];

export const PAYMENT_STATUSES = ['paid', 'pending', 'partial', 'refunded'];
export const PAYMENT_STATUS_LABELS = {
  paid: 'Paid',
  pending: 'Pending',
  partial: 'Partially paid',
  refunded: 'Refunded',
};

export const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'mobile_wallet', 'cheque', 'other'];
export const PAYMENT_METHOD_LABELS = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  mobile_wallet: 'Mobile wallet',
  cheque: 'Cheque',
  other: 'Other',
};

export const EXPENSE_CATEGORIES = [
  'rent', 'utilities', 'salaries', 'equipment', 'maintenance', 'marketing', 'supplies', 'software', 'other',
];
export const EXPENSE_CATEGORY_LABELS = {
  rent: 'Rent',
  utilities: 'Utilities',
  salaries: 'Salaries',
  equipment: 'Equipment',
  maintenance: 'Maintenance',
  marketing: 'Marketing',
  supplies: 'Supplies',
  software: 'Software',
  other: 'Other',
};

export const ATTENDANCE_METHODS = ['manual', 'qr', 'web', 'import'];

export const DIFFICULTY_LEVELS = ['beginner', 'intermediate', 'advanced'];

export const MUSCLE_GROUPS = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'core', 'quadriceps',
  'hamstrings', 'glutes', 'calves', 'full_body', 'cardio',
];

export const EQUIPMENT = [
  'none', 'barbell', 'dumbbell', 'kettlebell', 'machine', 'cable', 'band', 'bodyweight', 'cardio_machine', 'other',
];

export const NOTIFICATION_TYPES = [
  'system',
  'membership_expiring',
  'membership_expired',
  'membership_created',
  'payment_reminder',
  'payment_received',
  'birthday',
  'workout_assigned',
];

/** Channels that the notification dispatcher knows about. */
export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'sms', 'whatsapp', 'push'];

export const WORKOUT_ASSIGNMENT_STATUSES = ['assigned', 'in_progress', 'completed', 'archived'];

export const USER_STATUSES = ['active', 'invited', 'disabled'];

export const TENANT_STATUSES = ['active', 'suspended', 'trial'];

/** Pagination guard rails - never trust the client to ask for the whole table. */
export const PAGINATION = {
  defaultLimit: 25,
  maxLimit: 200,
  exportMaxRows: 10000,
};

/** Stable machine-readable error codes returned by the API. */
export const ERROR_CODES = {
  VALIDATION: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  MODULE_DISABLED: 'MODULE_DISABLED',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  INTERNAL: 'INTERNAL_ERROR',
};

export const FILE_PURPOSES = [
  'logo', 'logo_light', 'logo_dark', 'favicon', 'login_logo', 'login_background',
  'app_icon', 'splash', 'member_photo', 'trainer_photo', 'user_avatar', 'progress_photo',
  'document', 'expense_receipt', 'other',
];

/** Upload limits enforced by the API. */
export const UPLOAD_LIMITS = {
  image: { maxBytes: 5 * 1024 * 1024, mime: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'] },
  document: { maxBytes: 10 * 1024 * 1024, mime: ['application/pdf', 'image/png', 'image/jpeg'] },
};
