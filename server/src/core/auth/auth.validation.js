import { z } from 'zod';
import { email, password, requiredText, optionalPhone } from '../../utils/validate.js';

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(128),
  tenantSlug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Business code may only contain lowercase letters, numbers and dashes'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10).optional(),
});

export const forgotPasswordSchema = z.object({
  email,
  tenantSlug: z.string().trim().min(2).max(60),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: password,
});

// ---------------------------------------------------------------------------
// Onboarding (first-time setup wizard)
// ---------------------------------------------------------------------------

export const onboardingStartSchema = z.object({
  businessName: requiredText(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,60}$/, 'Use 2-60 lowercase letters, numbers or dashes')
    .optional(),
  vertical: z.string().trim().max(30).default('gym'),
  timezone: z.string().trim().max(60).optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
});

export const onboardingBrandingSchema = z.object({
  businessName: requiredText(120).optional(),
  shortName: z.string().trim().max(20).optional(),
  appName: z.string().trim().max(60).optional(),
  browserTitle: z.string().trim().max(80).optional(),
  description: z.string().trim().max(500).optional(),
  tagline: z.string().trim().max(160).optional(),
  email: z.string().trim().email().max(254).optional(),
  phone: optionalPhone,
  address: z.string().trim().max(250).optional(),
  city: z.string().trim().max(80).optional(),
  country: z.string().trim().max(80).optional(),
  website: z.string().trim().url().max(200).optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  currencySymbol: z.string().trim().max(4).optional(),
  timezone: z.string().trim().max(60).optional(),
});

export const onboardingThemeSchema = z.object({
  name: requiredText(60),
  config: z.record(z.unknown()),
  customCss: z.string().max(20_000).optional(),
});

export const onboardingModulesSchema = z.object({
  enabled: z.array(z.string().trim().max(40)).max(100),
});

export const onboardingOwnerSchema = z.object({
  fullName: requiredText(120),
  email,
  password,
  phone: optionalPhone,
});
