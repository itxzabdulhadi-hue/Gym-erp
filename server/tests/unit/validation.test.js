import { describe, it, expect } from 'vitest';

import { email, optionalEmail, password, money, uuid, isoDate, optionalDate, httpUrl, optionalUrl, phone, booleanish, requiredText, optionalText } from '../../src/utils/validate.js';

const ok = (schema, value) => schema.safeParse(value);

describe('input validation', () => {
  describe('email', () => {
    it('accepts normal addresses and trims them', () => {
      expect(ok(email, 'owner@gym.test').success).toBe(true);
      const parsed = email.safeParse('  Owner@Gym.Test  ');
      expect(parsed.success).toBe(true);
      expect(parsed.data).toBe(parsed.data.trim());
    });

    it('rejects malformed addresses', () => {
      for (const bad of ['', 'nope', 'nope@', '@gym.test', 'a@b', 'a b@gym.test', 'a@b@c.test']) {
        expect(ok(email, bad).success, bad).toBe(false);
      }
    });

    it('treats an optional email as optional but still validates it', () => {
      expect(ok(optionalEmail, undefined).success).toBe(true);
      expect(ok(optionalEmail, '').success).toBe(true);
      expect(ok(optionalEmail, 'nope').success).toBe(false);
      expect(ok(optionalEmail, 'ok@gym.test').success).toBe(true);
    });
  });

  describe('password', () => {
    it('accepts a strong password', () => {
      expect(ok(password, 'Demo1234!').success).toBe(true);
    });

    it('rejects short and weak passwords', () => {
      for (const bad of ['', 'abc', 'password', '12345678', 'abcdefgh']) {
        expect(ok(password, bad).success, bad).toBe(false);
      }
    });

    it('rejects anything absurdly long', () => {
      expect(ok(password, 'A1!'.repeat(500)).success).toBe(false);
    });
  });

  describe('money', () => {
    it('coerces numeric strings', () => {
      expect(money.safeParse('12.50').success).toBe(true);
      expect(money.safeParse(12.5).success).toBe(true);
    });

    it('rejects negatives and more than two decimals', () => {
      expect(ok(money, -1).success).toBe(false);
      expect(ok(money, 1.005).success).toBe(false);
    });

    it('rejects absurd magnitudes', () => {
      expect(ok(money, 1e12).success).toBe(false);
    });
  });

  describe('uuid', () => {
    it('accepts a real id and rejects anything else', () => {
      expect(ok(uuid, '00000000-0000-4000-8000-000000000000').success).toBe(true);
      for (const bad of ['1', 'not-a-uuid', "' OR 1=1 --", '', '00000000-0000-0000-0000-00000000000']) {
        expect(ok(uuid, bad).success, bad).toBe(false);
      }
    });
  });

  describe('dates', () => {
    it('accepts ISO dates', () => {
      expect(ok(isoDate, '2026-01-31').success).toBe(true);
      expect(ok(optionalDate, undefined).success).toBe(true);
      expect(ok(optionalDate, '').success).toBe(true);
    });

    it('rejects nonsense dates', () => {
      for (const bad of ['31/01/2026', 'not-a-date', '2026-13-45', "'; DROP TABLE members; --"]) {
        expect(ok(isoDate, bad).success, bad).toBe(false);
      }
    });
  });

  describe('urls', () => {
    it('accepts http(s) and rejects script/data URLs', () => {
      expect(ok(httpUrl, 'https://cdn.gym.test/logo.png').success).toBe(true);
      expect(ok(optionalUrl, undefined).success).toBe(true);
      for (const bad of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'ftp://x.test', 'not a url']) {
        expect(ok(httpUrl, bad).success, bad).toBe(false);
      }
    });
  });

  describe('text', () => {
    it('enforces length limits', () => {
      expect(ok(requiredText(10), 'abc').success).toBe(true);
      expect(ok(requiredText(10), 'a'.repeat(11)).success).toBe(false);
      expect(ok(requiredText(10), '   ').success).toBe(false);
      expect(ok(optionalText(10), undefined).success).toBe(true);
    });
  });

  describe('phone and booleans', () => {
    it('accepts plausible phone numbers', () => {
      expect(ok(phone, '+92 300 1234567').success).toBe(true);
      expect(ok(phone, 'abc').success).toBe(false);
    });

    it('coerces booleanish query strings', () => {
      for (const value of ['true', '1', true, 1]) {
        expect(booleanish.safeParse(value).data, String(value)).toBe(true);
      }
      for (const value of ['false', '0', false, 0]) {
        expect(booleanish.safeParse(value).data, String(value)).toBe(false);
      }
    });
  });
});
