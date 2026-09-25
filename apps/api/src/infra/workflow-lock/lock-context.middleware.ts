import { Injectable, NestMiddleware } from '@nestjs/common';
import { LOCK_OVERRIDE_IDS_HEADER, LOCK_OVERRIDE_REASON_HEADER, parseLockOverride } from '@nwm/core';
import { NextFunction, Request, Response } from 'express';
import { runWithLockContext } from './lock-context';

function header(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

@Injectable()
export class LockContextMiddleware implements NestMiddleware {
  use(request: Request, _response: Response, next: NextFunction): void {
    runWithLockContext(
      {
        override: parseLockOverride(
          header(request, LOCK_OVERRIDE_IDS_HEADER),
          header(request, LOCK_OVERRIDE_REASON_HEADER),
        ),
        author: header(request, 'x-user-email'),
        action: `${request.method} ${request.originalUrl.split('?')[0]}`,
      },
      next,
    );
  }
}
