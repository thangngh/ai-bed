import { HttpExceptionFilter } from '../filters/http-exception.filter';
import { HttpException, BadRequestException, NotFoundException, Logger } from '@nestjs/common';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let mockResponse: any;
  let logged: jest.SpyInstance;

  const hostWith = (request: any) =>
    ({
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => request,
      }),
    }) as any;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logged.mockRestore();
  });

  it('should format HttpException', () => {
    const exception = new BadRequestException({ error: { code: 'VALIDATION_ERROR', message: 'Invalid age' } });
    const host = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => ({ requestId: 'req-123' }),
      }),
    } as any;

    filter.catch(exception, host);
    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid age' },
      request_id: 'req-123',
    });
  });

  it('should handle unknown errors as 500', () => {
    const exception = new Error('Something broke');
    const host = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => ({ requestId: 'req-456' }),
      }),
    } as any;

    filter.catch(exception, host);
    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: { code: 'INTERNAL_ERROR', message: 'Đã có lỗi xảy ra' },
      request_id: 'req-456',
    });
  });

  it('logs the cause of an unhandled exception', () => {
    // A 500 whose only trace is `error_code: UNKNOWN` in the access log is a
    // 500 nobody can fix -- one such story-create failure cost an afternoon of
    // guessing before this line existed.
    filter.catch(
      new Error('Something broke'),
      hostWith({ requestId: 'req-456', method: 'POST', url: '/story/create' }),
    );

    expect(logged).toHaveBeenCalledTimes(1);
    const message = logged.mock.calls[0][0] as string;
    expect(message).toContain('POST /story/create');
    expect(message).toContain('req-456');
    expect(message).toContain('Something broke');
  });

  it('does not log an HttpException', () => {
    // Those are decisions the application made on purpose, and every one of
    // them is already in the access log. Logging them here would bury the
    // unhandled ones this exists to surface.
    filter.catch(
      new BadRequestException({ error: { code: 'VALIDATION_ERROR', message: 'x' } }),
      hostWith({ requestId: 'req-789', method: 'POST', url: '/story/create' }),
    );

    expect(logged).not.toHaveBeenCalled();
  });

  it('never puts the stack in the response body', () => {
    filter.catch(
      new Error('secret internal detail'),
      hostWith({ requestId: 'req-999', method: 'GET', url: '/x' }),
    );

    const body = JSON.stringify(mockResponse.json.mock.calls[0][0]);
    expect(body).not.toContain('secret internal detail');
    expect(body).not.toContain('at ');
  });

  it('keeps the message of an exception thrown with a plain string', () => {
    // Nest builds { statusCode, message, error: 'Bad Request' } here. Reading
    // `.error` off that yields the status text, not an error object -- the
    // message the thrower wrote is the whole point and must survive.
    filter.catch(
      new BadRequestException('Log path is outside the configured log directory'),
      hostWith({ requestId: 'req-1', method: 'POST', url: '/admin/dashboard/traffic/ingest' }),
    );

    const body = mockResponse.json.mock.calls[0][0];
    expect(body.error.message).toBe('Log path is outside the configured log directory');
    expect(typeof body.error.code).toBe('string');
    expect(mockResponse.status).toHaveBeenCalledWith(400);
  });

  it('keeps the message of a NotFoundException', () => {
    filter.catch(
      new NotFoundException('IP rule not found'),
      hostWith({ requestId: 'req-2', method: 'DELETE', url: '/admin/dashboard/ip/rules/7' }),
    );

    const body = mockResponse.json.mock.calls[0][0];
    expect(body.error.message).toBe('IP rule not found');
    expect(mockResponse.status).toHaveBeenCalledWith(404);
  });

  it('still passes our own nested error object through untouched', () => {
    filter.catch(
      new BadRequestException({ error: { code: 'VALIDATION_ERROR', message: 'Invalid age' } }),
      hostWith({ requestId: 'req-3', method: 'POST', url: '/x' }),
    );

    expect(mockResponse.json.mock.calls[0][0].error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Invalid age',
    });
  });
});
