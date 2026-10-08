import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { OAuthError } from './errors';

@Catch(OAuthError)
export class OAuthErrorFilter implements ExceptionFilter {
  catch(exception: OAuthError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    res
      .status(exception.status)
      .set({ 'Cache-Control': 'no-store', Pragma: 'no-cache', ...exception.headers })
      .json({ error: exception.error, error_description: exception.description });
  }
}
