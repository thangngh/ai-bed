import { Injectable, NestMiddleware, BadRequestException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantService } from '../../modules/tenant/tenant.service';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenantService: TenantService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    let tenantId = req.headers['x-tenant-id'] as string;

    if (!tenantId) {
      const tenant = await this.tenantService.create();
      tenantId = tenant.tenantId;
      res.setHeader('X-Tenant-Id', tenantId);
      (req as any).tenantId = tenantId;
      return next();
    }

    if (!UUID_REGEX.test(tenantId)) {
      throw new BadRequestException('INVALID_TENANT');
    }

    await this.tenantService.findOrCreate(tenantId);
    (req as any).tenantId = tenantId;
    next();
  }
}
