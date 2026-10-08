import { HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors';
import type { Env } from '../config/env';

/**
 * In DEMO_MODE the seeded demo accounts / clients are shared by every visitor,
 * so changes that would lock other visitors out are refused.
 */
export function assertNotProtected(env: Env, entity: { isProtected: boolean }, what: string): void {
  if (env.DEMO_MODE && entity.isProtected) {
    throw new ApiError(
      HttpStatus.FORBIDDEN,
      'demo_protected',
      `${what} is part of the shared demo and can't be changed. Create your own account or client to try this.`,
    );
  }
}
