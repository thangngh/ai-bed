import { ExceptionFilter, Catch, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { Response, Request } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Two exception shapes reach this filter and they must leave as one.
 *
 * Ours: `{ error: { code, message } }` -- pass the nested object through.
 * Nest's built-ins: `{ statusCode, message, error: 'Bad Request' }` -- here
 * `error` is the status text, so returning it would drop the message the
 * thrower wrote and leave the client with no `code` and no `message` at all.
 */
function normalizeError(res: string | object): { code: string; message: string } {
  if (typeof res === 'string') return { code: 'HTTP_ERROR', message: res };

  const nested = (res as any).error;
  if (nested && typeof nested === 'object') return nested;

  // class-validator style handlers can put an array of messages here.
  const raw = (res as any).message;
  const message = Array.isArray(raw) ? raw.join(', ') : raw;
  return {
    code: 'HTTP_ERROR',
    message: typeof message === 'string' && message ? message : String(nested ?? 'Request failed'),
  };
}

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
      body.error = normalizeError(exception.getResponse());
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
