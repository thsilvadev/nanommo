import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { WsException } from '@nestjs/websockets';
import { DataSource } from 'typeorm';

export const APPEARANCE_REQUIRED = 'APPEARANCE_REQUIRED';
const ALLOW_WITHOUT_APPEARANCE = 'allowWithoutAppearance';
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MESSAGE = 'Create your 3D character before playing';

/** Marks a controller or handler that a character without a 3D appearance may still call. */
export const AllowWithoutAppearance = () => SetMetadata(ALLOW_WITHOUT_APPEARANCE, true);

export function isAppearancePending(character: { appearance?: unknown } | null | undefined): boolean {
  return character?.appearance == null;
}

/**
 * Blocks every game action for a character that has not been through the 3D
 * creator. Registered globally and deny-by-default: any authenticated mutating
 * HTTP route or socket handler is refused unless it opts out with
 * `@AllowWithoutAppearance()`, so a new route cannot forget the check.
 *
 * An interceptor rather than a guard because it must run after the route's
 * own auth guard has populated `req.user`.
 */
@Injectable()
export class AppearanceRequiredInterceptor implements NestInterceptor {
  /** Appearance is write-once, so "has one" never changes back and is safe to remember. */
  private readonly cleared = new Set<string>();

  constructor(
    private readonly reflector: Reflector,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<ReturnType<CallHandler['handle']>> {
    const type = context.getType<'http' | 'ws' | 'rpc'>();
    let userId: string | undefined;
    if (type === 'http') {
      const request = context.switchToHttp().getRequest();
      if (READ_METHODS.has(String(request.method).toUpperCase())) return next.handle();
      userId = request.user?.userId;
    } else if (type === 'ws') {
      userId = context.switchToWs().getClient()?.userId;
    }
    if (!userId) return next.handle();

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_APPEARANCE, [context.getHandler(), context.getClass()]);
    if (allowed) return next.handle();

    if (await this.isPending(userId)) {
      const body = { code: APPEARANCE_REQUIRED, message: MESSAGE };
      throw type === 'ws' ? new WsException(body) : new ForbiddenException(body);
    }
    return next.handle();
  }

  private async isPending(userId: string): Promise<boolean> {
    if (this.cleared.has(userId)) return false;
    const rows = await this.dataSource.query(
      'SELECT ("appearance" IS NULL) AS "pending" FROM "characters" WHERE "userId" = $1 LIMIT 1',
      [userId],
    );
    // No character yet: nothing to block (character creation itself is exempt anyway).
    if (!rows.length) return false;
    if (rows[0].pending === true) return true;
    this.cleared.add(userId);
    return false;
  }
}
