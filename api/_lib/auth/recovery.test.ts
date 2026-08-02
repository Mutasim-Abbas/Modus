import { generateRecoveryCode, normalizeRecoveryCode } from './recovery.js';

describe('generateRecoveryCode', () => {
  it('produces four groups of four from the documented shape', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('never includes visually ambiguous characters (0/O, 1/I/L)', () => {
    const codes = Array.from({ length: 500 }, () => generateRecoveryCode()).join('');
    expect(codes).not.toMatch(/[01ILO]/);
  });

  it('never repeats across calls', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateRecoveryCode()));
    expect(codes.size).toBe(200);
  });
});

describe('normalizeRecoveryCode', () => {
  it('uppercases and strips dashes', () => {
    expect(normalizeRecoveryCode('abcd-efgh-jklm-npqr')).toBe('ABCDEFGHJKLMNPQR');
  });

  it('strips whitespace from a copy-pasted code', () => {
    expect(normalizeRecoveryCode('  ABCD EFGH JKLM NPQR  ')).toBe('ABCDEFGHJKLMNPQR');
  });

  it('is idempotent — normalizing an already-normalized code changes nothing', () => {
    const code = generateRecoveryCode();
    const normalized = normalizeRecoveryCode(code);
    expect(normalizeRecoveryCode(normalized)).toBe(normalized);
  });

  it('two different-looking inputs for the same code normalize identically', () => {
    expect(normalizeRecoveryCode('abcd-efgh-jklm-npqr')).toBe(
      normalizeRecoveryCode('ABCD EFGHJKLMNPQR'),
    );
  });
});
