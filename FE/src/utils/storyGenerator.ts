import { BedtimeStory, StoryFormInput, StorySegments } from '../types';
import { apiClient } from './api';

const SECTION_MAP: Record<string, keyof StorySegments> = {
  opening: 'opening',
  context: 'situation',
  conflict: 'challenge',
  resolution: 'ending',
  interaction_1: 'interaction1',
  interaction_2: 'interaction2',
  interaction_3: 'interaction3',
  moral: 'moralSummary',
};

export function mapSectionsToSegments(sections: any[]): StorySegments {
  const segments: Partial<StorySegments> = {};
  for (const section of sections) {
    const segmentKey = SECTION_MAP[section.type];
    if (segmentKey) {
      segments[segmentKey] = section.text || section.prompt || '';
    }
  }
  // Fill empty segments with fallback values
  return {
    opening: segments.opening || '',
    situation: segments.situation || '',
    interaction1: segments.interaction1 || '',
    challenge: segments.challenge || '',
    interaction2: segments.interaction2 || sections.find((s: any) => s.type === 'interaction')?.prompt || '',
    ending: segments.ending || '',
    interaction3: segments.interaction3 || '',
    moralSummary: segments.moralSummary || sections.find((s: any) => s.type === 'moral_summary')?.text || '',
  };
}

export async function generateBedtimeStory(input: StoryFormInput): Promise<BedtimeStory> {
  try {
    const data = await apiClient<any>('/story/create', {
      method: 'POST',
      body: JSON.stringify({
        child_name: input.childName,
        age: input.childAge,
        theme: input.favoriteTopic,
        goal: input.lesson || '',
        mood: input.mood || 'vui vẻ',
        language: 'vi',
        gender: input.gender || 'unspecified',
        favorite_character: input.favoriteCharacter || '',
      }),
    });

    const storyData = data.data || data;
    const sections = storyData.sections || [];
    const segments = mapSectionsToSegments(sections);

    return {
      id: `story-${Date.now()}`,
      title: storyData.title || 'Câu chuyện của bé',
      childName: input.childName,
      childAge: input.childAge,
      topic: input.favoriteTopic,
      lesson: input.lesson,
      segments,
      createdAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('Failed to generate story via BE:', err);
    throw err;
  }
}
