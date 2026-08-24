import { IpStatus } from '../entities/ip-state.entity';

export class IpStateDto {
  ip!: string;
  status!: IpStatus;
  score?: number;
  blockedUntil?: string | null;
  autoBlocked?: boolean;
  reason?: string | null;
}

