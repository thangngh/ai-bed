import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('memory_items')
export class MemoryItem {
  @PrimaryColumn({ name: 'memory_id', type: 'text' })
  memoryId!: string;

  @Column({ name: 'tenant_id', type: 'text' })
  tenantId!: string;

  @Column({ name: 'child_id', type: 'text', nullable: true })
  childId?: string;

  @Column({ name: 'story_id', type: 'text', nullable: true })
  storyId?: string;

  @Column({ name: 'memory_type', type: 'text' })
  memoryType!: string;

  @Column({ name: 'memory_key', type: 'text' })
  memoryKey!: string;

  @Column({ name: 'memory_value', type: 'text' })
  memoryValue!: string;

  @Column({ name: 'confidence', type: 'real', default: 0.5 })
  confidence!: number;

  @Column({ name: 'source_text', type: 'text', nullable: true })
  sourceText?: string;

  @Column({ name: 'source', type: 'text', nullable: true })
  source?: string;

  @Column({ name: 'last_reinforced_at', type: 'text', nullable: true })
  lastReinforcedAt?: string;

  @Column({ name: 'is_active', type: 'integer', default: 1 })
  isActive!: number;

  @Column({ name: 'expires_at', type: 'text', nullable: true })
  expiresAt?: string;

  @Column({ name: 'created_at', type: 'text', default: () => "datetime('now')" })
  createdAt?: string;
}
