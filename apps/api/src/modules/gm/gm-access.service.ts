import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';

export type GmRoleQueryExecutor = Pick<EntityManager, 'query'>;

/** Reads an account's role straight from the database on every command, so revoking GM takes effect at once. */
@Injectable()
export class GmAccessService {
  private readonly logger = new Logger(GmAccessService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Reuse an open transaction connection when supplied; never borrow from the pool while holding its locks. */
  async isGm(userId: string | undefined, executor: GmRoleQueryExecutor = this.dataSource): Promise<boolean> {
    if (!userId) return false;
    try {
      const rows: Array<{ role: string }> = await executor.query('SELECT "role" FROM users WHERE id = $1', [userId]);
      return rows[0]?.role === 'gm';
    } catch (error) {
      // Before migration 1800800000000-UserRole the column does not exist: nobody is a GM.
      this.logger.warn(`GM role lookup failed (is migration UserRole1800800000000 applied?): ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
