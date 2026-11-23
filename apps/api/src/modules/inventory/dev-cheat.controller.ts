import { Controller, Get, Logger, Query } from '@nestjs/common';
import { InventoryService } from './inventory.service';

/** TEMP DEV CHEAT — remove after Diet/food QA is complete. */
@Controller('inventory')
export class DevCheatController {
  private readonly logger = new Logger(DevCheatController.name);

  constructor(private readonly inventoryService: InventoryService) {}

  @Get('__dev_7f3a91c2/grant-all-foods')
  async grantAllFoods() {
    return this.inventoryService.grantAllFoodsCheat(10);
  }

  /**
   * Any equipment at any refinement level, e.g.
   * /inventory/__dev_7f3a91c2/grant-equip?item=equip_body_phys_t3,equip_head_phys_t3&refine=12&character=Name
   * (`character` optional: defaults to the most recently updated character).
   */
  @Get('__dev_7f3a91c2/grant-equip')
  async grantEquip(@Query('item') item?: string, @Query('refine') refine?: string, @Query('character') character?: string) {
    const ids = String(item ?? '').split(',').map((id) => id.trim()).filter(Boolean);
    return this.inventoryService.grantEquipmentCheat(ids, Number(refine ?? 0), character);
  }

  @Get('__dev_7f3a91c2/reset-diet')
  async resetDiet() {
    this.logger.log('RESET DIET cheat requested');
    try {
      const result = await this.inventoryService.resetDietCheat();
      this.logger.log(
        `RESET DIET cheat succeeded: characterId=${result.characterId} dietCount=${result.diet.length} activeFoodBuff=${result.activeFoodBuff ? 'present' : 'null'}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `RESET DIET cheat failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
      );
      throw error;
    }
  }

  @Get('__dev_7f3a91c2/upgrade-diet')
  async upgradeDiet() {
    this.logger.log('UPGRADE DIET cheat requested');
    try {
      const result = await this.inventoryService.upgradeDietCheat();
      this.logger.log(
        `UPGRADE DIET cheat succeeded: characterId=${result.characterId} dietCount=${result.diet.length}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `UPGRADE DIET cheat failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
