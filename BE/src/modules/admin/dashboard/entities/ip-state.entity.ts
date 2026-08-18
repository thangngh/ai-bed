import { Entity, PrimaryColumn, Column } from 'typeorm';

// 'temp_blocked' is reserved for a future time-limited block. It is validated
// in IpStateQueryDto and ranked in severityRank, but no code path currently
// assigns it to an IpState -- do not remove it.
export type IpStatus = 'ok' | 'throttled' | 'temp_blocked' | 'perm_blocked';

@Entity('ip_states')
export class IpState {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  ip!: string;
  @Column({ type: 'varchar', length: 16, default: 'ok' })
  status!: IpStatus;
  @Column({ type: 'varchar', length: 32, default: 'default' })
  tier!: string;
  @Column({ type: 'real', default: 0 })
  score!: number;
  @Column({ name: 'blocked_until', type: 'varchar', length: 25, nullable: true })
  blockedUntil!: string | null;
  @Column({ name: 'auto_blocked', type: 'boolean', default: false })
  autoBlocked!: boolean;
  @Column({ type: 'text', nullable: true })
  reason!: string | null;
  @Column({ name: 'updated_at', type: 'varchar', length: 25, default: () => "datetime('now')" })
  updatedAt!: string;
}
