import { Controller, Get } from '@nestjs/common';

/**
 * Liveness for docker-compose and for the SPA/integration scripts waiting on
 * the stack. Deliberately outside the tenant middleware: a probe must not mint
 * a tenant row on every poll.
 */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', service: 'Bedtime Story BE' };
  }
}
