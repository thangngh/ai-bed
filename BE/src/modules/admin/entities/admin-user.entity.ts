import { Entity, PrimaryColumn, Column, Index } from 'typeorm';
import { NOW_UTC_TEXT_EXPR } from '../../../database/now-default-expr';

@Entity('admin_users')
export class AdminUser {
  @PrimaryColumn({ name: 'admin_id', type: 'text' })
  adminId!: string;

  @Index({ unique: true })
  @Column({ name: 'username', type: 'text', unique: true })
  username!: string;

  /** Format is owned by auth/password.ts: `scrypt$N$r$p$salt$hash`. */
  @Column({ name: 'password_hash', type: 'text' })
  passwordHash!: string;

  @Column({ name: 'created_at', type: 'text', default: () => NOW_UTC_TEXT_EXPR })
  createdAt?: string;

  /** The cheapest audit trail there is: a login nobody made shows up here. */
  @Column({ name: 'last_login_at', type: 'text', nullable: true })
  lastLoginAt?: string | null;
}
