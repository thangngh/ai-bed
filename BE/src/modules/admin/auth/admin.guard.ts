import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyAdminToken } from './jwt';

export interface AdminPrincipal {
  adminId: string;
  username: string;
}

export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const parts = header.split(' ');
  if (parts.length !== 2) return null;
  const [scheme, value] = parts;
  if (scheme.toLowerCase() !== 'bearer') return null;
  if (!value) return null;
  return value;
}

const UNAUTHORIZED: UnauthorizedException = new UnauthorizedException({
  error: { code: 'UNAUTHORIZED', message: 'Phiên không hợp lệ hoặc đã hết hạn' },
});

function unauthorized(): UnauthorizedException {
  return UNAUTHORIZED;
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req: any = context.switchToHttp().getRequest();
    const token = extractBearer(req?.headers?.authorization);
    if (!token) throw unauthorized();

    const secret = this.config.get<string>('admin.secret');
    if (!secret) throw unauthorized();

    const payload = verifyAdminToken(token, secret);
    if (!payload) throw unauthorized();

    const principal: AdminPrincipal = { adminId: payload.sub, username: payload.username };
    req.admin = principal;
    return true;
  }
}
