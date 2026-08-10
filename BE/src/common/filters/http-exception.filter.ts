import { ExceptionFilter, Catch, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { Response, Request } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('UnhandledException');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const requestId = (request as any).requestId || uuidv4();
    let status = 500;
    let body: any = {
      error: { code: 'INTERNAL_ERROR', message: 'Đã có lỗi xảy ra' },
      request_id: requestId,
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      body.error =
        typeof res === 'string'
          ? { code: 'HTTP_ERROR', message: res }
          : (res as any).error ?? (res as any);
      body.request_id = requestId;
    } else {
      // Anything that is not an HttpException is a bug: nobody chose this
      // status, the response body says only "Đã có lỗi xảy ra", and until now
      // nothing anywhere recorded what actually happened. A 500 that leaves no
      // trace is a 500 nobody can fix -- LoggingInterceptor prints
      // `error_code: UNKNOWN` and the cause is gone.
      //
      // Server-side only. The client still gets the generic body; leaking a
      // stack trace to the caller is the thing this filter exists to prevent.
      const detail = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(
        `${request.method} ${request.url} request_id=${requestId}\n${detail}`,
      );
    }

    response.status(status).json(body);
  }
}
