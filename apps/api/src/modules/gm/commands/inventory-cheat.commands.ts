import { Injectable } from '@nestjs/common';
import { InventoryService } from '../../inventory/inventory.service';
import { GmCommandError, intArg, type GmCommand } from '../gm.types';

function requireName(name: string | undefined): string {
  if (!name?.trim()) throw new GmCommandError('Pass the exact character name');
  return name.trim();
}

@Injectable()
export class GrantEquipCommand implements GmCommand {
  readonly name = 'grant-equip';
  readonly usage = '<charName> <itemId[,itemId...]> [refineLevel 0-12]';
  readonly summary = 'Puts equipment at a refinement level in a character\'s inventory';
  constructor(private readonly inventory: InventoryService) {}

  async run([character, items, refine]: string[]): Promise<string> {
    const name = requireName(character);
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
  readonly usage = '<charName> [quantity 1-99]';
  readonly summary = 'Gives a character every food';
  constructor(private readonly inventory: InventoryService) {}

  async run([character, quantity]: string[]): Promise<string> {
    const name = requireName(character);
    const qty = quantity === undefined ? 10 : intArg(quantity, 'quantity', 1, 99);
    const result = await this.inventory.grantAllFoodsCheat(qty, name);
    return `Gave ${name} ${qty}× each of ${result.foods.length} foods.`;
  }
}

@Injectable()
export class ResetDietCommand implements GmCommand {
  readonly name = 'reset-diet';
  readonly usage = '<charName>';
  readonly summary = 'Finishes a character\'s digestion (hungry again; diet levels kept)';
  constructor(private readonly inventory: InventoryService) {}

  async run([character]: string[]): Promise<string> {
    const name = requireName(character);
    const result = await this.inventory.resetDietCheat(name);
    return `${name} is hungry again (${result.diet.length} diet slot(s) digested).`;
  }
}

@Injectable()
export class UpgradeDietCommand implements GmCommand {
  readonly name = 'upgrade-diet';
  readonly usage = '<charName>';
  readonly summary = 'Raises every food in a character\'s diet one level (max 3)';
  constructor(private readonly inventory: InventoryService) {}

  async run([character]: string[]): Promise<string> {
    const name = requireName(character);
    const result = await this.inventory.upgradeDietCheat(name);
    return `${name}'s diet upgraded (${result.diet.length} slot(s)).`;
  }
}
