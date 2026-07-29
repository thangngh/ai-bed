export class StoryResponse {
  story_id!: string;
  title!: string;
  sections!: any[];
  interaction_count!: number;
  word_count!: number;
  safety_status!: string;
  is_fallback!: boolean;

  static from(story: any, engineResult?: any) {
    const resp = new StoryResponse();
    resp.story_id = story.storyId;
    resp.title = story.title;
    resp.sections = engineResult?.content || [];
    resp.interaction_count = (engineResult?.content || []).filter((s: any) => s.type === 'interaction').length;
    resp.word_count = story.wordCount || 0;
    resp.safety_status = story.safetyStatus || 'PENDING';
    resp.is_fallback = story.isFallback === 1;
    return resp;
  }

  static detail(story: any) {
    return {
      story_id: story.storyId,
      title: story.title,
      child_name: story.childName,
      age: story.age,
      theme: story.theme,
      goal: story.goal,
      mood: story.mood,
      safety_status: story.safetyStatus,
      word_count: story.wordCount,
      is_fallback: story.isFallback === 1,
      is_saved: story.isSaved === 1,
      sections: (story.sections || []).map((s: any) => ({
        type: s.sectionType,
        text: s.content,
        prompt: s.interactionPrompt,
        order: s.orderIndex,
      })),
      created_at: story.createdAt,
    };
  }
}
