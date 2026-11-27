import { Module } from '@nestjs/common';
import { RedisModule } from '../../config/redis.module';
import { GmAccessService } from './gm-access.service';
import { GmTeleportModeService } from './gm-teleport-mode.service';

@Module({ imports: [RedisModule], providers: [GmAccessService, GmTeleportModeService], exports: [GmAccessService, GmTeleportModeService] })
export class GmTeleportModeModule {}
