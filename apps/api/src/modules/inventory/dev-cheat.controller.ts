import { Controller, Get, NotFoundException } from '@nestjs/common';
import { InventoryService } from './inventory.service';

/** TEMP DEV CHEAT — remove after Diet/food QA is complete. */
@Controller('inventory')
export class DevCheatController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('__dev_7f3a91c2/grant-all-foods')
  async grantAllFoods() {
    if (process.env.NODE_ENV === 'production') throw new NotFoundException();
    return this.inventoryService.grantAllFoodsCheat(10);
  }
}
