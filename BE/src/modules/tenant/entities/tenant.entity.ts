import { Entity, PrimaryColumn, Column } from 'typeorm';
import { NOW_UTC_TEXT_EXPR } from '../../../database/now-default-expr';

@Entity('tenants')
export class Tenant {
  @PrimaryColumn({ name: 'tenant_id', type: 'text' })
  tenantId!: string;

  @Column({ name: 'name', type: 'text', default: 'anonymous' })
  name!: string;

  @Column({ name: 'auth_type', type: 'text', default: 'local' })
  authType!: string;

  /** Provider-side stable subject id. Null for anonymous MVP tenants. */
  @Column({ name: 'auth_key', type: 'text', nullable: true })
  authKey?: string | null;

  /** Display and support lookups only -- identity is matched on auth_key. */
  @Column({ name: 'email', type: 'text', nullable: true })
  email?: string | null;

  @Column({ name: 'metadata', type: 'text', nullable: true })
  metadata?: string;

  @Column({ name: 'created_at', type: 'text', default: () => NOW_UTC_TEXT_EXPR })
  createdAt?: string;

  @Column({ name: 'updated_at', type: 'text', default: () => NOW_UTC_TEXT_EXPR })
  updatedAt?: string;
}
