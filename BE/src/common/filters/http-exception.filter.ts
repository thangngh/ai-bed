import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { Response, Request } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = 500;
    let body: any = {
      error: { code: 'INTERNAL_ERROR', message: 'Đã có lỗi xảy ra' },
      request_id: (request as any).requestId || uuidv4(),
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      body.error = typeof res === 'string' ? { code: 'HTTP_ERROR', message: res } : (res as any);
      body.request_id = (request as any).requestId || uuidv4();
    }

    response.status(status).json(body);
  }
}
