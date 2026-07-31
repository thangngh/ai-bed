import { Entity, PrimaryColumn, Column, OneToMany } from 'typeorm';
import { StorySection } from './story-section.entity';

@Entity('stories')
export class Story {
  @PrimaryColumn({ name: 'story_id', type: 'text' })
  storyId!: string;

  @Column({ name: 'tenant_id', type: 'text' })
  tenantId!: string;

  @Column({ name: 'child_id', type: 'text', nullable: true })
  childId?: string;

  @Column({ name: 'request_id', type: 'text', nullable: true })
  requestId?: string;

  @Column({ name: 'title', type: 'text' })
  title!: string;

  @Column({ name: 'content', type: 'text' })
  content!: string;

  @Column({ name: 'structure_json', type: 'text', nullable: true })
  structureJson?: string;

  @Column({ name: 'theme', type: 'text' })
  theme!: string;

  @Column({ name: 'goal', type: 'text', nullable: true })
  goal?: string | null;

  @Column({ name: 'mood', type: 'text', nullable: true })
  mood?: string | null;

  @Column({ name: 'language', type: 'text', default: 'vi' })
  language!: string;

  @Column({ name: 'safety_status', type: 'text', default: 'PENDING' })
  safetyStatus!: string;

  @Column({ name: 'llm_calls', type: 'integer', default: 0 })
  llmCalls!: number;

  @Column({ name: 'retry_count', type: 'integer', default: 0 })
  retryCount!: number;

  @Column({ name: 'total_latency_ms', type: 'integer', nullable: true })
  totalLatencyMs?: number;

  @Column({ name: 'word_count', type: 'integer', nullable: true })
  wordCount?: number;

  @Column({ name: 'is_fallback', type: 'integer', default: 0 })
  isFallback!: number;

  @Column({ name: 'is_saved', type: 'integer', default: 0 })
  isSaved!: number;

  @Column({ name: 'created_at', type: 'text', default: () => "datetime('now')" })
  createdAt?: string;

  @OneToMany(() => StorySection, section => section.story)
  sections?: StorySection[];
}
