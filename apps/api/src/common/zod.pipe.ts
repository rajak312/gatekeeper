import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Validates and normalizes a request body / query with a zod schema. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      const first = result.error.issues[0];
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'validation_failed',
        message: first
          ? `${first.path.join('.') ? `${first.path.join('.')}: ` : ''}${first.message}`
          : 'Invalid request',
        details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}
