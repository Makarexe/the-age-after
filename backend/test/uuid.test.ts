import { describe, expect, it } from 'vitest';
import { offlineUuid, parseUuid, undashed } from '../src/lib/crypto.js';

describe('offlineUuid', () => {
  it('matches the vectors checked against the real server', () => {
    expect(offlineUuid('Notch')).toBe('b50ad385-829d-3141-a216-7e7d7539ba7f');
    expect(offlineUuid('Steve')).toBe('5627dd98-e6be-3c21-b8a8-e92344183641');
    expect(offlineUuid('Alex')).toBe('36532b5e-c442-3dbb-a24c-c7e55d0f979a');
  });

  it('is case sensitive', () => {
    expect(offlineUuid('steve')).not.toBe(offlineUuid('Steve'));
  });

  it('parses dashed and undashed forms', () => {
    expect(parseUuid('b50ad385829d3141a2167e7d7539ba7f')).toBe('b50ad385-829d-3141-a216-7e7d7539ba7f');
    expect(parseUuid('B50AD385-829D-3141-A216-7E7D7539BA7F')).toBe('b50ad385-829d-3141-a216-7e7d7539ba7f');
    expect(parseUuid('nope')).toBeNull();
    expect(undashed('b50ad385-829d-3141-a216-7e7d7539ba7f')).toBe('b50ad385829d3141a2167e7d7539ba7f');
  });
});
