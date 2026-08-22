import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { childClient } from '../childClient';

const VALID_TENANT = '12345678-1234-4123-8123-123456789abc';

describe('childClient', () => {
  beforeEach(() => {
    localStorage.setItem('bsc_tenant_id', VALID_TENANT);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps every profile field from the list response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        children: [{
          child_id: 'c1',
          child_name: 'An',
          age: 4,
          gender: 'girl',
          interests: 'khủng long',
          preferred_characters: 'Thỏ Bông',
          bedtime_goal: 'Chia sẻ',
        }],
      }),
    }));

    const list = await childClient.list();

    expect(list).toEqual([{
      childId: 'c1',
      childName: 'An',
      age: 4,
      gender: 'girl',
      interests: 'khủng long',
      preferredCharacters: 'Thỏ Bông',
      bedtimeGoal: 'Chia sẻ',
    }]);
  });

  it('turns null optional fields into undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        children: [{
          child_id: 'c2',
          child_name: 'Bo',
          age: 3,
          gender: null,
          interests: null,
          preferred_characters: null,
          bedtime_goal: null,
        }],
      }),
    }));

    const [child] = await childClient.list();

    expect(child.interests).toBeUndefined();
    expect(child.bedtimeGoal).toBeUndefined();
  });

  it('returns null when a by-name lookup misses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ child_id: null }),
    }));

    expect(await childClient.getByName('Khong')).toBeNull();
  });

  it('sends child_name on update so a rename reaches the BE', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        child_id: 'c3', child_name: 'Moi', age: 4,
        gender: null, interests: null, preferred_characters: null, bedtime_goal: null,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const updated = await childClient.update('c3', { child_name: 'Moi', age: 4 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/child-profile/c3/update');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ child_name: 'Moi', age: 4 });
    expect(updated.childName).toBe('Moi');
  });

  it('uses the POST compatibility endpoint to delete a profile', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    await childClient.delete('c4');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/child-profile/c4/delete');
    expect(init.method).toBe('POST');
  });
});
