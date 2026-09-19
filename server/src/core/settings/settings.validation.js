import { z } from 'zod';
import { booleanish } from '../../utils/validate.js';

/**
 * Tenant settings schemas.
 *
 * Settings are stored as a jsonb document on the tenant row, one namespace per
 * settings screen. Each namespace is validated here, so the API can never
 * persist an unknown or malformed setting.
 */

export const settingsSections = {
  general: z.object({
    fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
    weekStartsOn: z.enum(['monday', 'sunday', 'saturday']).optional(),
    dateFormat: z.enum(['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY']).optional(),
    timeFormat: z.enum(['24h', '12h']).optional(),
  }),
  memberships: z.object({
    graceDays: z.number().int().min(0).max(60).optional(),
    autoExpire: booleanish.optional(),
    allowFreeze: booleanish.optional(),
    maxFreezeDaysPerYear: z.number().int().min(0).max(365).optional(),
    expiryWarningDays: z.number().int().min(0).max(90).optional(),
  }),
  attendance: z.object({
    allowMultipleCheckinsPerDay: booleanish.optional(),
    autoCheckoutHours: z.number().int().min(0).max(24).optional(),
    requireCheckout: booleanish.optional(),
  }),
  payments: z.object({
    invoicePrefix: z.string().trim().min(1).max(10).optional(),
    taxRate: z.number().min(0).max(100).optional(),
    currency: z.string().trim().length(3).optional(),
    allowPartialPayments: booleanish.optional(),
    lowBalanceThreshold: z.number().min(0).max(1_000_000).optional(),
  }),
  security: z.object({
    passwordMinLength: z.number().int().min(8).max(64).optional(),
    sessionTimeoutMinutes: z.number().int().min(5).max(10_080).optional(),
    requireStrongPassword: booleanish.optional(),
  }),
  notifications: z.object({
    channels: z
      .object({
        in_app: booleanish.optional(),
        email: booleanish.optional(),
        sms: booleanish.optional(),
        whatsapp: booleanish.optional(),
        push: booleanish.optional(),
      })
      .optional(),
    events: z.record(z.record(booleanish)).optional(),
  }),
  data: z.object({
    retentionMonths: z.number().int().min(0).max(240).optional(),
  }),
};

export function validateSection(section, patch) {
  const schema = settingsSections[section];
  if (!schema) return null;
  const result = schema.safeParse(patch);
  return result.success ? result.data : { __error: result.error.issues };
}
