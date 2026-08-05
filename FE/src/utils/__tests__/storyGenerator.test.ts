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

  it("keeps the BE story id so saving and rating hit the right row", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ story_id: 'abc-123', title: 'T', sections: [] }),
    }));

    const story = await generateBedtimeStory({ childName: 'An', childAge: 4, favoriteTopic: 'Động vật' });

    expect(story.id).toBe('be-abc-123');
  });

  it('falls back to a local id when the BE sends none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ title: 'T', sections: [] }),
    }));

    const story = await generateBedtimeStory({ childName: 'An', childAge: 4, favoriteTopic: 'Động vật' });

    expect(story.id).toMatch(/^story-\d+$/);
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
    // The pause follows the situation, so it belongs to the first prompt slot.
    expect(segments.interaction1).toBe('Bé nghĩ sao?');
    expect(segments.interaction2).toBe('');
    expect(segments.moralSummary).toBe('Bài học');
  });

  it('places each unnumbered interaction after the part it interrupts', () => {
    const segments = mapSectionsToSegments([
      { type: 'opening', text: 'Mở đầu', order: 0 },
      { type: 'context', text: 'Bối cảnh', order: 1 },
      { type: 'interaction', prompt: 'Câu hỏi 1', order: 2 },
      { type: 'conflict', text: 'Thử thách', order: 3 },
      { type: 'interaction', prompt: 'Câu hỏi 2', order: 4 },
      { type: 'resolution', text: 'Kết thúc', order: 5 },
      { type: 'interaction', prompt: 'Câu hỏi 3', order: 6 },
    ]);
    expect(segments.interaction1).toBe('Câu hỏi 1');
    expect(segments.interaction2).toBe('Câu hỏi 2');
    expect(segments.interaction3).toBe('Câu hỏi 3');
  });

  it('honours explicitly numbered interaction sections', () => {
    const segments = mapSectionsToSegments([
      { type: 'interaction_3', prompt: 'Cuối', order: 1 },
      { type: 'interaction_1', prompt: 'Đầu', order: 2 },
    ]);
    expect(segments.interaction1).toBe('Đầu');
    expect(segments.interaction3).toBe('Cuối');
    expect(segments.interaction2).toBe('');
  });

  it('keeps rising action and climax instead of dropping them', () => {
    const segments = mapSectionsToSegments([
      { type: 'conflict', text: 'Xung đột', order: 0 },
      { type: 'rising_action', text: 'Cao trào dần', order: 1 },
      { type: 'climax', text: 'Đỉnh điểm', order: 2 },
    ]);
    expect(segments.challenge).toBe('Xung đột\n\nCao trào dần\n\nĐỉnh điểm');
  });

  it('keeps the narrative text that surrounds an interaction question', () => {
    const segments = mapSectionsToSegments([
      { type: 'context', text: 'Bối cảnh', order: 0 },
      { type: 'interaction', text: 'Thỏ dừng lại bên bờ suối.', prompt: 'Bé đoán xem?', order: 1 },
    ]);
    expect(segments.interaction1).toBe('Bé đoán xem?');
    expect(segments.situation).toBe('Bối cảnh\n\nThỏ dừng lại bên bờ suối.');
  });

  it('orders sections by `order`, not by array position', () => {
    const segments = mapSectionsToSegments([
      { type: 'resolution', text: 'Kết', order: 2 },
      { type: 'opening', text: 'Mở', order: 0 },
    ]);
    expect(segments.opening).toBe('Mở');
    expect(segments.ending).toBe('Kết');
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
