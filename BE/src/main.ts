import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ValidationPipe } from './common/pipes/validation.pipe';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TenantInterceptor } from './common/interceptors/tenant.interceptor';

/**
 * Origins allowed to call this API from a browser, from `CORS_ORIGINS` as a
 * comma-separated list.
 *
 * Empty by default, and empty means *no* cross-origin browser access -- which
 * is the correct answer for the shipped architecture, not a limitation of it.
 * nginx serves the SPA and proxies `/api/` on the same origin, so the app
 * itself never makes a cross-origin request and never needs a CORS header.
 *
 * This replaces a bare `app.enableCors()`, which reflected whatever `Origin`
 * arrived: any page on the internet could script a request to this API in a
 * visitor's browser. Nothing here is protected by a cookie, so that was not an
 * immediate CSRF hole, but it did hand any site the ability to drive a
 * visitor's tenant -- and it costs nothing to close.
 *
 * Set it when the SPA is genuinely served from another origin:
 *   CORS_ORIGINS=https://app.example.com,https://staging.example.com
 */
function corsOrigins(): string[] {
  return (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const origins = corsOrigins();
  if (origins.length > 0) {
    app.enableCors({
      origin: origins,
      // The tenant and the admin session both travel in headers, so the
      // methods and headers are enumerated rather than reflected.
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id'],
      maxAge: 600,
    });
    console.log(`CORS enabled for: ${origins.join(', ')}`);
  }
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe());
  app.useGlobalInterceptors(new LoggingInterceptor(), new TenantInterceptor());
  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`BE running on http://localhost:${port}`);
}
bootstrap();
