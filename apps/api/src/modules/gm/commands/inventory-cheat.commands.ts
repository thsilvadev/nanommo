import { Injectable } from '@nestjs/common';
import { DataService } from '../../data/data.service';
import { InventoryService } from '../../inventory/inventory.service';
import { GmCommandError, intArg, targetName, type GmCommand, type GmContext } from '../gm.types';

@Injectable()
export class GrantEquipCommand implements GmCommand {
  readonly name = 'grant-equip';
  readonly usage = '[charName] <itemId[,itemId...]> [refineLevel 0-12]';
  readonly summary = 'Puts equipment at a refinement level in a character\'s inventory (yours by default)';
  constructor(private readonly inventory: InventoryService, private readonly dataService: DataService) {}

  async run(args: string[], ctx: GmContext): Promise<string> {
    // No name when the first argument is already the item list.
    const firstIsItems = !!args[0] && args[0].split(',').every((id) => !!id.trim() && !!this.dataService.getItemById(id.trim()));
    const [character, items, refine] = firstIsItems ? [undefined, ...args] : args;
    const name = targetName(character, ctx);
    const ids = String(items ?? '').split(',').map((id) => id.trim()).filter(Boolean);
    if (!ids.length) throw new GmCommandError('Pass at least one item id');
    const level = refine === undefined ? 0 : intArg(refine, 'refineLevel', 0, 12);
    const result = await this.inventory.grantEquipmentCheat(ids, level, name);
    return `Gave ${result.name} ${result.granted.map((g) => `${g.itemId}${level ? ` +${level}` : ''}`).join(', ')}.`;
  }
}

@Injectable()
export class GrantFoodsCommand implements GmCommand {
  readonly name = 'grant-foods';
  readonly usage = '[charName] [quantity 1-99]';
  readonly summary = 'Gives a character every food (yours by default)';
  constructor(private readonly inventory: InventoryService) {}

  async run(args: string[], ctx: GmContext): Promise<string> {
    // A lone number is the quantity for yourself.
    const [character, quantity] = args[0] !== undefined && /^\d+$/.test(args[0]) ? [undefined, args[0]] : args;
    const name = targetName(character, ctx);
    const qty = quantity === undefined ? 10 : intArg(quantity, 'quantity', 1, 99);
    const result = await this.inventory.grantAllFoodsCheat(qty, name);
    return `Gave ${name} ${qty}× each of ${result.foods.length} foods.`;
  }
}

@Injectable()
export class ResetDietCommand implements GmCommand {
  readonly name = 'reset-diet';
  readonly usage = '[charName]';
  readonly summary = 'Finishes a character\'s digestion (hungry again; diet levels kept; yours by default)';
  constructor(private readonly inventory: InventoryService) {}

  async run([character]: string[], ctx: GmContext): Promise<string> {
    const name = targetName(character, ctx);
    const result = await this.inventory.resetDietCheat(name);
    return `${name} is hungry again (${result.diet.length} diet slot(s) digested).`;
  }
}

@Injectable()
export class UpgradeDietCommand implements GmCommand {
  readonly name = 'upgrade-diet';
  readonly usage = '[charName]';
  readonly summary = 'Raises every food in a character\'s diet one level (max 3; yours by default)';
  constructor(private readonly inventory: InventoryService) {}

  async run([character]: string[], ctx: GmContext): Promise<string> {
    const name = targetName(character, ctx);
    const result = await this.inventory.upgradeDietCheat(name);
    return `${name}'s diet upgraded (${result.diet.length} slot(s)).`;
  }
}
