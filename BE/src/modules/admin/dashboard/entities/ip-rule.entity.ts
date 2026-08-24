import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

export type RuleType = 'ip' | 'cidr';
export type RuleAction = 'allow' | 'deny';

@Entity('ip_rules')
@Index(['enabled'])
@Index(['pattern'])
export class IpRule {
  @PrimaryGeneratedColumn()
  id!: number;
  @Column({ type: 'varchar', length: 8 })
  type!: RuleType;
  @Column({ type: 'varchar', length: 64 })
  pattern!: string;
  @Column({ type: 'varchar', length: 8 })
  action!: RuleAction;
  @Column({ type: 'varchar', length: 32, default: 'default' })
  tier!: string;
  @Column({ type: 'text', nullable: true })
  note!: string | null;
  @Column({ name: 'created_by', type: 'varchar', length: 64 })
  createdBy!: string;
  @Column({ name: 'created_at', type: 'varchar', length: 25, default: () => "datetime('now')" })
  createdAt!: string;
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;
}
