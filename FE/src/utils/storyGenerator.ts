import { BedtimeStory, StoryFormInput, StorySegments } from '../types';
import { apiClient, STORY_TIMEOUT_MS } from './api';

type InteractionSlot = 'interaction1' | 'interaction2' | 'interaction3';

const INTERACTION_SLOTS: InteractionSlot[] = ['interaction1', 'interaction2', 'interaction3'];

/**
 * The Engine plans a story out of {opening, context, conflict, rising_action,
 * climax, resolution, interaction, moral} sections, but the story view has a
 * fixed four-paragraph shape. Several Engine types therefore collapse into one
 * slot -- notably the whole rising action into `challenge` -- so no prose is
 * dropped on the way to the screen.
 */
const NARRATIVE_SLOT: Record<string, keyof StorySegments> = {
  opening: 'opening',
  context: 'situation',
  situation: 'situation',
  conflict: 'challenge',
  rising_action: 'challenge',
  climax: 'challenge',
  resolution: 'ending',
  ending: 'ending',
  moral: 'moralSummary',
  moral_summary: 'moralSummary',
};

/**
 * An unnumbered `interaction` lands in the pause that follows the part of the
 * story it interrupts, which is where the reader expects to be asked.
 */
const PREFERRED_INTERACTION: Record<string, InteractionSlot> = {
  opening: 'interaction1',
  situation: 'interaction1',
  challenge: 'interaction2',
  ending: 'interaction3',
  moralSummary: 'interaction3',
};

function emptySegments(): StorySegments {
  return {
    opening: '',
    situation: '',
    interaction1: '',
    challenge: '',
    interaction2: '',
    ending: '',
    interaction3: '',
    moralSummary: '',
  };
}

/** First free interaction slot at or after `preferred`, wrapping around. */
function pickInteractionSlot(segments: StorySegments, preferred: InteractionSlot): InteractionSlot | null {
  const start = INTERACTION_SLOTS.indexOf(preferred);
  for (let step = 0; step < INTERACTION_SLOTS.length; step++) {
    const slot = INTERACTION_SLOTS[(start + step) % INTERACTION_SLOTS.length];
    if (!segments[slot]) return slot;
  }
  return null;
}

export function mapSectionsToSegments(sections: any[]): StorySegments {
  const segments = emptySegments();

  // `order` is the Engine's own sequencing; array position is the tie-break so
  // a response without it still reads in the order it arrived.
  const ordered = (sections || [])
    .map((section, index) => ({ section, index }))
    .sort((a, b) => {
      const oa = Number.isFinite(a.section?.order) ? a.section.order : a.index;
      const ob = Number.isFinite(b.section?.order) ? b.section.order : b.index;
      return oa - ob || a.index - b.index;
    })
    .map((entry) => entry.section);

  const append = (slot: keyof StorySegments, text: string) => {
    if (!text) return;
    segments[slot] = segments[slot] ? `${segments[slot]}\n\n${text}` : text;
  };

  // Anything unrecognised flows into the slot the story is currently in.
  let current: keyof StorySegments = 'opening';

  for (const section of ordered) {
    const type = String(section?.type || '').toLowerCase();
    const text = String(section?.text || '').trim();
    const prompt = String(section?.prompt || '').trim();

    const numbered = /^interaction[_-]?([123])$/.exec(type);
    if (numbered || type === 'interaction') {
      const preferred = numbered
        ? INTERACTION_SLOTS[Number(numbered[1]) - 1]
        : PREFERRED_INTERACTION[current] || 'interaction1';
      const slot = pickInteractionSlot(segments, preferred);
      const question = prompt || text;
      if (slot) segments[slot] = question;
      // A fourth interaction has nowhere of its own to go; keep the question
      // rather than losing it.
      else append('interaction3', question);
      // An interaction section also carries narrative text around its question.
      if (prompt && text) append(current, text);
      continue;
    }

    const slot = NARRATIVE_SLOT[type];
    if (slot) {
      append(slot, text || prompt);
      current = slot;
    } else {
      append(current, text || prompt);
    }
  }

  return segments;
}

export async function generateBedtimeStory(input: StoryFormInput): Promise<BedtimeStory> {
  const data = await apiClient<any>('/story/create', {
    method: 'POST',
    timeoutMs: STORY_TIMEOUT_MS,
    body: JSON.stringify({
      child_id: input.childId,
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
  const segments = mapSectionsToSegments(storyData.sections || []);

  return {
    // The `be-` prefix marks a story the BE owns, so saving it and rating it
    // reach the right row instead of a client-only id.
    id: storyData.story_id ? `be-${storyData.story_id}` : `story-${Date.now()}`,
    title: storyData.title || 'Câu chuyện của bé',
    childName: input.childName,
    childAge: input.childAge,
    topic: input.favoriteTopic,
    lesson: input.lesson,
    segments,
    createdAt: new Date().toISOString(),
  };
}
