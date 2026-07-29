import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const start = Date.now();
    const requestId = (req as any).requestId || 'unknown';

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log(JSON.stringify({
            request_id: requestId,
            tenant_id: (req as any).tenantId,
            method: req.method,
            path: req.path,
            status: context.switchToHttp().getResponse().statusCode,
            latency_ms: Date.now() - start,
            event: 'end',
          }));
        },
        error: (err) => {
          this.logger.error(JSON.stringify({
            request_id: requestId,
            tenant_id: (req as any).tenantId,
            method: req.method,
            path: req.path,
            error_code: err?.response?.error?.code || 'UNKNOWN',
            latency_ms: Date.now() - start,
            event: 'error',
          }));
        },
      })
    );
  }
}
