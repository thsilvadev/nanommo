import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/** Reads an account's role straight from the database on every command, so revoking GM takes effect at once. */
@Injectable()
export class GmAccessService {
  private readonly logger = new Logger(GmAccessService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async isGm(userId: string | undefined): Promise<boolean> {
    if (!userId) return false;
    try {
      const rows: Array<{ role: string }> = await this.dataSource.query('SELECT "role" FROM users WHERE id = $1', [userId]);
      return rows[0]?.role === 'gm';
    } catch (error) {
      // Before migration 1800800000000-UserRole the column does not exist: nobody is a GM.
      this.logger.warn(`GM role lookup failed (is migration UserRole1800800000000 applied?): ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
