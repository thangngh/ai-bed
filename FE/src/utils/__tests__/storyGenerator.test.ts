import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateBedtimeStory, mapSectionsToSegments } from '../storyGenerator';
import { StoryFormInput } from '../../types';

const VALID_TENANT = '12345678-1234-4123-8123-123456789abc';

describe('storyGenerator', () => {
  beforeEach(() => {
    localStorage.setItem('bsc_tenant_id', VALID_TENANT);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts snake_case payload to /story/create', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          title: 'Chú thỏ dũng cảm',
          sections: [{ type: 'opening', text: 'Ngày xửa...', order: 1 }],
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const input: StoryFormInput = {
      childName: 'An',
      childAge: 4,
      favoriteTopic: 'Động vật',
      gender: 'girl',
      lesson: 'Dũng cảm',
      mood: 'vui vẻ',
      favoriteCharacter: 'Mèo',
    };
    const story = await generateBedtimeStory(input);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/story/create');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      child_name: 'An',
      age: 4,
      theme: 'Động vật',
      goal: 'Dũng cảm',
      mood: 'vui vẻ',
      language: 'vi',
      gender: 'girl',
      favorite_character: 'Mèo',
    });
    expect(story.title).toBe('Chú thỏ dũng cảm');
    expect(story.segments.opening).toBe('Ngày xửa...');
  });

  it('maps engine sections to story segments', () => {
    const segments = mapSectionsToSegments([
      { type: 'opening', text: 'Mở đầu', order: 1 },
      { type: 'context', text: 'Bối cảnh', order: 2 },
      { type: 'interaction', prompt: 'Bé nghĩ sao?', order: 3 },
      { type: 'moral', text: 'Bài học', order: 4 },
    ]);
    expect(segments.opening).toBe('Mở đầu');
    expect(segments.situation).toBe('Bối cảnh');
    expect(segments.interaction2).toBe('Bé nghĩ sao?');
    expect(segments.moralSummary).toBe('Bài học');
  });

  it('rethrows errors from the API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { code: 'ENGINE_ERROR', message: 'Engine down' } }),
    }));

    const input: StoryFormInput = { childName: 'An', childAge: 4, favoriteTopic: 'Động vật' };
    await expect(generateBedtimeStory(input)).rejects.toThrow('ENGINE_ERROR');
  });
});
