export interface MemoryContext {
  type: string;
  key: string;
  value: string;
  confidence: number;
}

export interface StorySummary {
  title: string;
  theme: string;
}

export class GenerateDto {
  childName!: string;
  age!: number;
  theme!: string;
  goal?: string;
  mood?: string;
  language?: string;
  memories?: MemoryContext[];
  recentStories?: StorySummary[];
  tenantId!: string;
  gender?: string;
  favoriteCharacter?: string;
}
