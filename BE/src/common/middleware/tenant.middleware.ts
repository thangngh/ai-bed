import { Injectable, NestMiddleware, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import { TenantService } from '../../modules/tenant/tenant.service';
import { verifyTenantToken } from '../../modules/auth/tenant-jwt';
import type { ParentAuthConfig } from '../../modules/auth/auth.config';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const parts = header.split(' ');
  if (parts.length !== 2) return null;
  const [scheme, value] = parts;
  if (scheme.toLowerCase() !== 'bearer' || !value) return null;
  return value;
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly tenantService: TenantService,
    private readonly config: ConfigService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // A signed session outranks X-Tenant-Id. The header is self-asserted --
    // whoever sends it picks the tenant -- so once a request proves which
    // account it belongs to, the header is not consulted at all.
    const signedTenantId = this.tenantFromToken(req);
    if (signedTenantId) {
      (req as any).tenantId = signedTenantId;
      (req as any).isAuthenticated = true;
      return next();
    }

    let tenantId = req.headers['x-tenant-id'] as string;

    if (!tenantId) {
      const tenant = await this.tenantService.create();
      tenantId = tenant.tenantId;
      res.setHeader('X-Tenant-Id', tenantId);
      (req as any).tenantId = tenantId;
      return next();
    }

    if (!UUID_REGEX.test(tenantId)) {
      throw new BadRequestException({
        error: { code: 'INVALID_TENANT', message: 'Invalid tenant ID format' },
      });
    }

    const tenant = await this.tenantService.findOrCreate(tenantId);

    // Once an account has signed in with Google, its old anonymous id must
    // stop working as a way past the login -- otherwise the header would be a
    // permanent bypass for exactly the accounts that bothered to authenticate.
    if (tenant.authType !== 'local') {
      throw new UnauthorizedException({
        error: { code: 'AUTH_REQUIRED', message: 'Phiên này cần đăng nhập lại' },
      });
    }

    (req as any).tenantId = tenantId;
    next();
  }

  /** @returns the tenant id proven by a parent access token, if there is one. */
  private tenantFromToken(req: Request): string | null {
    const parentAuth = this.config.get<ParentAuthConfig>('parentAuth');
    if (!parentAuth?.enabled) return null;

    const token = bearer(req.headers.authorization);
    if (!token) return null;

    const payload = verifyTenantToken(token, parentAuth.secret);
    if (!payload) {
      // Falling back to the header here would turn an expired session into a
      // silent downgrade onto some anonymous tenant. Fail loudly so the SPA
      // knows to refresh instead.
      throw new UnauthorizedException({
        error: { code: 'SESSION_INVALID', message: 'Phiên không hợp lệ hoặc đã hết hạn' },
      });
    }
    return payload.sub;
  }
}
