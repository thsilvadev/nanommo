import { Injectable } from '@nestjs/common';
import { GmTeleportModeService } from '../gm-teleport-mode.service';
import { GmCommandError, type GmCommand, type GmContext } from '../gm.types';

@Injectable()
export class TeleportCommand implements GmCommand {
  readonly name = 'teleport';
  readonly usage = '';
  readonly summary = 'Toggles instant teleport to world-map destinations';
  constructor(private readonly mode: GmTeleportModeService) {}
  async run(args: string[], ctx: GmContext): Promise<string> {
    if (args.length) throw new GmCommandError('This command takes no arguments');
    const enabled = await this.mode.toggle(ctx.userId, ctx.characterId);
    return `World-map teleport ${enabled ? 'enabled' : 'disabled'}.`;
  }
}
