import { PipeTransform, Injectable, ArgumentMetadata, UnprocessableEntityException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

/**
 * Fields whose submitted value must never travel back out in an error body.
 * The 422 for a rejected login would otherwise contain the typed password.
 * Substring match so `currentPassword` and `apiToken` are covered too.
 */
const SENSITIVE_FIELD_PARTS = ['password', 'token', 'secret', 'authorization'];

export function isSensitiveField(field: string): boolean {
  const lower = field.toLowerCase();
  return SENSITIVE_FIELD_PARTS.some((part) => lower.includes(part));
}

@Injectable()
export class ValidationPipe implements PipeTransform<any> {
  async transform(value: any, { metatype }: ArgumentMetadata) {
    if (!metatype || !this.toValidate(metatype)) return value;

    const object = plainToInstance(metatype, value);
    const errors = await validate(object);
    if (errors.length > 0) {
      const firstError = errors[0];
      const constraints = firstError.constraints || {};
      const message = Object.values(constraints)[0] || 'Validation failed';
      const details: Record<string, any> = { field: firstError.property };
      if (!isSensitiveField(firstError.property)) {
        details.value = value[firstError.property];
      }
      throw new UnprocessableEntityException({
        error: {
          code: 'VALIDATION_ERROR',
          message,
          details,
        },
      });
    }
    return object;
  }

  private toValidate(metatype: Function): boolean {
    const types: Function[] = [String, Boolean, Number, Array, Object];
    return !types.includes(metatype);
  }
}
