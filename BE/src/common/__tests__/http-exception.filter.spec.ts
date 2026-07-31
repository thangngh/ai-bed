import { HttpExceptionFilter } from '../filters/http-exception.filter';
import { HttpException, BadRequestException } from '@nestjs/common';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let mockResponse: any;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
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
      error: { error: { code: 'VALIDATION_ERROR', message: 'Invalid age' } },
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
});
