import { Entity, PrimaryColumn, Column } from 'typeorm';
import { NOW_UTC_TEXT_EXPR } from '../../../database/now-default-expr';

@Entity('feedbacks')
export class Feedback {
  @PrimaryColumn({ name: 'feedback_id', type: 'text' })
  feedbackId!: string;

  @Column({ name: 'tenant_id', type: 'text' })
  tenantId!: string;

  @Column({ name: 'story_id', type: 'text' })
  storyId!: string;

  @Column({ name: 'child_id', type: 'text', nullable: true })
  childId?: string;

  @Column({ name: 'listened_complete', type: 'integer', nullable: true })
  listenedComplete?: number;

  @Column({ name: 'wants_more', type: 'integer', nullable: true })
  wantsMore?: number;

  @Column({ name: 'suitable', type: 'integer', nullable: true })
  suitable?: number;

  @Column({ name: 'rating', type: 'integer', nullable: true })
  rating?: number;

  @Column({ name: 'note', type: 'text', nullable: true })
  note?: string;

  @Column({ name: 'created_at', type: 'text', default: () => NOW_UTC_TEXT_EXPR })
  createdAt?: string;
}
