import { describe, expect, it } from 'vitest';
import { playBlockReason } from '../src/shared/backstory';

describe('playBlockReason', () => {
  const base = { isAdmin: false, backstoryReview: null } as const;
  it('locks everything but an approved backstory', () => {
    expect(playBlockReason({ ...base, backstoryStatus: 'none' })).toContain('Заполните');
    expect(playBlockReason({ ...base, backstoryStatus: 'pending' })).toContain('ждёт');
    expect(playBlockReason({ ...base, backstoryStatus: 'rejected', backstoryReview: 'мало текста' })).toContain('мало текста');
    expect(playBlockReason({ ...base, backstoryStatus: 'approved' })).toBeNull();
  });
  it('admins always play', () => {
    expect(playBlockReason({ isAdmin: true, backstoryStatus: 'none', backstoryReview: null })).toBeNull();
  });
});
