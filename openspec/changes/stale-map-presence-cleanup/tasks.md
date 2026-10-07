# Tasks

## 1. MapService leave-map presence cleanup

- [x] 1.1 Inject `GatewayService` into `MapService` and verify the module still compiles
- [x] 1.2 Capture `oldMapId` at the top of `MapService.leaveMap` before any state changes
- [x] 1.3 Call `gatewayService.removePlayerFromMap(characterId, oldMapId)` and `gatewayService.publishMapPresence(oldMapId)` when `oldMapId` is set, after the character state is saved
- [x] 1.4 Verify that `POST /maps/leave` no longer leaves stale Redis presence for the exited map

## 2. BattleService presence cleanup on town transitions

- [x] 2.1 In `BattleService.handleCharacterDeath`, call `gatewayService.removePlayerFromMap` and `gatewayService.publishMapPresence` for `battle.mapId` after the character is saved to town
- [x] 2.2 In `BattleService.resolveBattle`, capture the character's `currentMapId` before any town-return logic runs; when `returningToTown || hungryAfterBattle`, call `removePlayerFromMap` and `publishMapPresence` for that map after the character state is saved
- [x] 2.3 Verify that dying or returning to town after battle resolution removes the character from Redis presence

## 3. Tests and verification

- [x] 3.1 Add a test case to `apps/api/test/map-presence.test.js` (or a new file) proving that a mock HTTP leave path triggers `removePlayerFromMap` and `publishMapPresence`
- [x] 3.2 Add a test case proving that `handleCharacterDeath` triggers presence cleanup
- [x] 3.3 Add a test case proving that `resolveBattle` with `returnToTownAfterBattle` triggers presence cleanup
- [x] 3.4 Run the existing `map-presence` and `encounter-search` tests and confirm they still pass
