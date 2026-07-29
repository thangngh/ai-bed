import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Story } from './story.entity';

@Entity('story_sections')
export class StorySection {
  @PrimaryColumn({ name: 'section_id', type: 'text' })
  sectionId!: string;

  @Column({ name: 'story_id', type: 'text' })
  storyId!: string;

  @ManyToOne(() => Story, story => story.sections)
  @JoinColumn({ name: 'story_id' })
  story?: Story;

  @Column({ name: 'tenant_id', type: 'text' })
  tenantId!: string;

  @Column({ name: 'section_type', type: 'text' })
  sectionType!: string;

  @Column({ name: 'content', type: 'text' })
  content!: string;

  @Column({ name: 'order_index', type: 'integer' })
  orderIndex!: number;

  @Column({ name: 'interaction_prompt', type: 'text', nullable: true })
  interactionPrompt?: string;

  @Column({ name: 'interaction_options', type: 'text', nullable: true })
  interactionOptions?: string;
}
