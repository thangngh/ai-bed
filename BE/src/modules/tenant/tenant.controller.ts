import { Controller, Post } from '@nestjs/common';
import { TenantService } from './tenant.service';

@Controller('tenant')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Post('init')
  async init() {
    const tenant = await this.tenantService.create();
    return {
      tenant_id: tenant.tenantId,
      message: 'Tenant initialized',
    };
  }
}
