import crypto from 'node:crypto';

export const newId = () => crypto.randomUUID();

/** URL-safe random token (refresh tokens, password reset links, check-in QR). */
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Tokens are stored hashed; the raw value only ever leaves the server once. */
export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function pad(value, length = 4) {
  return String(value).padStart(length, '0');
}

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export const memberNumber = (sequence) => `M-${pad(sequence)}`;
export const invoiceNumber = (year, sequence) => `INV-${year}-${pad(sequence, 5)}`;
