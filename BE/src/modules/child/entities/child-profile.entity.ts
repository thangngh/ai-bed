import { Entity, PrimaryColumn, Column } from 'typeorm';
import { NOW_UTC_TEXT_EXPR } from '../../../database/now-default-expr';

@Entity('child_profiles')
export class ChildProfile {
  @PrimaryColumn({ name: 'child_id', type: 'text' })
  childId!: string;

  @Column({ name: 'tenant_id', type: 'text' })
  tenantId!: string;

  @Column({ name: 'child_name', type: 'text' })
  childName!: string;

  @Column({ name: 'age', type: 'integer' })
  age!: number;

  @Column({ name: 'interests', type: 'text', nullable: true })
  interests?: string | null;

  @Column({ name: 'preferred_characters', type: 'text', nullable: true })
  preferredCharacters?: string | null;

  @Column({ name: 'bedtime_goal', type: 'text', nullable: true })
  bedtimeGoal?: string | null;

  @Column({ name: 'gender', type: 'text', nullable: true })
  gender?: string | null;

  @Column({ name: 'language', type: 'text', default: 'vi' })
  language!: string;

  @Column({ name: 'is_active', type: 'integer', default: 1 })
  isActive!: number;

  @Column({ name: 'created_at', type: 'text', default: () => NOW_UTC_TEXT_EXPR })
  createdAt?: string;

  @Column({ name: 'updated_at', type: 'text', default: () => NOW_UTC_TEXT_EXPR })
  updatedAt?: string;
}
