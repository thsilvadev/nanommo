import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Character } from '../../database/entities';
import { GmAccessService } from './gm-access.service';
import { GM_COMMANDS, GmCommandError, tokenizeGmLine, type GmCommand } from './gm.types';

export type GmCommandResult = { success: true; message: string } | { success: false; error: string };

/** Parses a `/command args` line, checks the caller is a GM, runs the command and audits it. */
@Injectable()
export class GmService {
  private readonly logger = new Logger(GmService.name);
  private readonly commands = new Map<string, GmCommand>();

  constructor(
    @Inject(GM_COMMANDS) commands: GmCommand[],
    private readonly access: GmAccessService,
    @InjectRepository(Character) private readonly characterRepo: Repository<Character>,
  ) {
    const help: GmCommand = { name: 'gm-help', usage: '', summary: 'Lists the GM commands', run: async () => this.helpText() };
    for (const command of [help, ...commands]) {
      if (this.commands.has(command.name)) throw new Error(`Duplicate GM command /${command.name}`);
      this.commands.set(command.name, command);
    }
  }

  list(): GmCommand[] { return [...this.commands.values()].sort((a, b) => a.name.localeCompare(b.name)); }

  private helpText(): string {
    return ['GM commands (quote names with spaces: "Some Name"):', ...this.list().map((c) => `/${c.name} ${c.usage}`.trim() + ` — ${c.summary}`)].join('\n');
  }

  /**
   * Non-GMs (and unknown commands) get UNKNOWN_COMMAND, the same answer as any
   * other unknown slash command: the GM commands are not advertised.
   */
  async execute(userId: string | undefined, characterId: string | undefined, line: unknown): Promise<GmCommandResult> {
    if (typeof line !== 'string' || !line.trim().startsWith('/') || line.length > 500) return { success: false, error: 'UNKNOWN_COMMAND' };
    const [head, ...args] = tokenizeGmLine(line.trim().slice(1));
    const command = this.commands.get(String(head ?? '').toLowerCase());
    if (!command || !characterId || !(await this.access.isGm(userId))) return { success: false, error: 'UNKNOWN_COMMAND' };
    const gm = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!gm) return { success: false, error: 'UNKNOWN_COMMAND' };
    const audit = `[gm] ${gm.name} (${characterId}) /${command.name} ${args.join(' ')}`.trim();
    try {
      const message = await command.run(args, { userId: userId!, characterId, characterName: gm.name });
      this.logger.warn(`${audit} -> ok: ${message}`);
      return { success: true, message };
    } catch (error) {
      const expected = error instanceof GmCommandError || error instanceof HttpException;
      const message = error instanceof Error ? error.message : String(error);
      if (expected) this.logger.warn(`${audit} -> rejected: ${message}`);
      else this.logger.error(`${audit} -> failed: ${error instanceof Error ? error.stack ?? message : message}`);
      return { success: false, error: expected ? `/${command.name}: ${message}\nUsage: /${command.name} ${command.usage}`.trim() : `/${command.name} failed: ${message}` };
    }
  }
}
