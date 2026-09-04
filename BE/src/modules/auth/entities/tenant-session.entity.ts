import { Entity, PrimaryColumn, Column, Index } from 'typeorm';
import { NOW_UTC_TEXT_EXPR } from '../../../database/now-default-expr';

/**
 * One row per live refresh token. The raw token only ever exists in the
 * parent's cookie; what is stored here is its SHA-256, so this table cannot be
 * replayed against the API if it leaks.
 */
@Entity('tenant_sessions')
export class TenantSession {
  @PrimaryColumn({ name: 'session_id', type: 'text' })
  sessionId!: string;

  @Index()
  @Column({ name: 'tenant_id', type: 'text' })
  tenantId!: string;

  @Column({ name: 'token_hash', type: 'text', unique: true })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'text' })
  expiresAt!: string;

  /** Set on logout, and on reuse of an already-rotated token. */
  @Column({ name: 'revoked_at', type: 'text', nullable: true })
  revokedAt?: string | null;

  @Column({ name: 'created_ip', type: 'text', nullable: true })
  createdIp?: string | null;

  @Column({ name: 'created_at', type: 'text', default: () => NOW_UTC_TEXT_EXPR })
  createdAt?: string;
}
