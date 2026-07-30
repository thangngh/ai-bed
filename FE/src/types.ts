export type AgeGroup = 3 | 4 | 5 | 6;

export type GenderOption = 'boy' | 'girl' | 'unspecified';

export interface StoryFormInput {
  childName: string;
  childAge: AgeGroup;
  favoriteTopic: string;
  gender?: GenderOption;
  lesson?: string;
  mood?: string;
  favoriteCharacter?: string;
}

export interface StorySegments {
  opening: string;
  situation: string;
  interaction1: string;
  challenge: string;
  interaction2: string;
  ending: string;
  interaction3: string;
  moralSummary: string;
}

export interface BedtimeStory {
  id: string;
  title: string;
  childName: string;
  childAge: number;
  topic: string;
  lesson?: string;
  segments: StorySegments;
  createdAt: string;
}

export interface FeedbackData {
  storyId: string;
  listenedUntilEnd: boolean | null;
  wantsMoreStories: 'yes' | 'normal' | 'no' | null;
  suitabilityRating: number;
  comment?: string;
}

export interface ChildProfile {
  childId: string;
  childName: string;
  age: AgeGroup;
  gender?: string;
  interests?: string;
  preferredCharacters?: string;
  bedtimeGoal?: string;
  createdAt?: string;
}

export interface MemoryContext {
   interests: { type: string; key: string; value: string; confidence: number }[];
   preferences: { type: string; key: string; value: string; confidence: number }[];
   recentThemes: { type: string; key: string; value: string; confidence: number }[];
   behaviors: { type: string; key: string; value: string; confidence: number }[];
 }

 export interface StoryStats {
   total_stories: number;
   unique_themes: number;
   top_themes: { theme: string; count: number }[];
   stories_per_day: { day: string; count: number }[];
   avg_word_count: number;
   avg_interaction_count: number;
 }

 export interface FeedbackStats {
   total_feedback: number;
   avg_rating: number;
   listened_complete_rate: number;
   wants_more_rate: number;
   rating_distribution: { rating: number; count: number }[];
 }

 export interface MemoryStats {
   top_interests: { value: string; confidence: number }[];
   top_characters: string[];
   common_goals: { goal: string; count: number }[];
 }

 export interface OverviewStats {
   children: {
     childId: string;
     childName: string;
     total_stories: number;
     avg_rating: number | null;
     last_active: string | null;
   }[];
   total_stories: number;
   total_children: number;
 }

export type AppScreen = 'home' | 'form' | 'loading' | 'story' | 'feedback' | 'error' | 'profile' | 'analytics';
