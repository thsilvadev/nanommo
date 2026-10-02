import { Controller, Get, Logger } from '@nestjs/common';
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
