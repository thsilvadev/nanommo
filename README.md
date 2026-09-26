# NanoMMO - Browser Idle MMORPG

Um MMORPG idle baseado em navegador com sistema determinístico de batalhas, automatização FFXII-style (Gambits), e economia de mercado P2P.

## Stack

- **Backend:** NestJS 10+ (Node 20+, TypeScript strict)
- **Database:** PostgreSQL 16
- **Cache/Realtime:** Redis 7 + Socket.IO
- **Frontend:** Angular 18+ (standalone components, Signals)
- **Reverse Proxy:** Caddy
- **Infra:** Docker Compose (local dev)

## Setup & Running

### 1. Install Dependencies

```bash
# Install pnpm globally
npm install -g pnpm

# Install workspace dependencies
pnpm install
```

### 2. Environment Variables

```bash
cp .env.example .env.local
# Edit .env.local with your configuration
```

### 3. Start Docker Services

```bash
# Start postgres, redis, backend in containers
docker-compose up

# Or start in background
docker-compose up -d
```

### 4. Run TypeORM Migrations

```bash
# Auto-run on backend startup (RUN_MIGRATIONS=true in .env)
# Or manually:
pnpm -F @nanommo/api db:migrate
```

### 5. Start Backend (Dev Mode)

```bash
cd apps/api
pnpm dev
# Runs on http://localhost:3000
```

### 6. Start Frontend (Dev Mode - future)

```bash
cd apps/web
pnpm dev
# Runs on http://localhost:4200
```

### 7. Access via Caddy Reverse Proxy

```
http://localhost
# Caddy proxies to:
# /api/* -> localhost:3000
# /socket.io -> localhost:3000
# /* -> localhost:4200 (frontend)
```

## Project Structure

```
nanommo/
├── apps/
│   ├── api/                    # NestJS backend
│   │   ├── src/
│   │   │   ├── modules/        # 10+ feature modules
│   │   │   │   ├── auth/
│   │   │   │   ├── character/
│   │   │   │   ├── battle/
│   │   │   │   ├── gambit/
│   │   │   │   ├── inventory/
│   │   │   │   ├── equipment/
│   │   │   │   ├── map/
│   │   │   │   ├── town/
│   │   │   │   ├── market/
│   │   │   │   ├── mail/
│   │   │   │   ├── chat/
│   │   │   │   └── gateway/
│   │   │   ├── database/       # TypeORM entities, migrations
│   │   │   └── main.ts
│   │   └── Dockerfile
│   └── web/                    # Angular frontend (TODO)
├── packages/
│   └── shared/                 # @nanommo/shared
│       ├── enums/              # All game enums
│       ├── types/              # Game data types
│       ├── dto/                # Request/response DTOs
│       └── battle-engine/      # Pure TS battle simulator
├── docker-compose.yml
└── README.md (this file)
```

## Development Roadmap

### Immediate Next Steps (Critical Path to MVP)

1. **Battle Queue Generation** (`apps/api/src/modules/battle/battle.service.ts`)
   - Implement `queueBattles()` - simulate 5 battles ahead deterministically
   - Generate `BattleQueueEntry` rows with `startAt`/`endAt` timestamps
   - Schedule BullMQ jobs for battle resolution

2. **Battle Queue Resolver Job**
   - Implement `resolveBattle()` - apply XP, gold, drops to character
   - Handle level-ups and stat recalculations
   - Delete resolved entries and re-queue if queue depth < 5

3. **Inventory/Equipment Logic** 
   - Complete item addition/removal with stacking
   - Implement equipment stat rolls using deterministic PRNG
   - Validate weapon combinations (Sword+Shield, Greatsword alone, etc.)

4. **Map & Monster Selection**
   - Implement deterministic monster selection using `Mulberry32`
   - Complete `MapKillCounter` with epoch rollover at 10k kills
   - Add encounter search time calculation based on player count (Redis presence)

5. **Gambit Evaluator**
   - Complete gambit condition evaluation (HP bands, status, cooldowns, etc.)
   - Implement action legality checks (skill equipped, SP cost, item in stock)
   - Use in battle loop for NPC action selection

6. **WebSocket Events**
   - Implement presence tracking (Redis sets for `map:{mapId}`, `online:count`)
   - Emit `battleResolved`, `characterDied`, `characterLevelUp` events
   - Broadcast chat messages and market order updates

7. **Frontend Skeleton** (`apps/web/`)
   - Create Angular 18 app with standalone components
   - Setup routing (auth, character-sheet, gambit-editor, grind, town, market, mail, chat)
   - Create signal-based state management for character, inventory, battle queue

### Secondary Features (Post-MVP)

8. Market order matching engine
9. Mail system delivery on market sales
10. Chat moderation (muting based on reports)
11. Skill tree and weapon proficiency system
12. Full gambit editor UI with drag-drop and validation tooltips
13. i18n setup (pt-BR default, en scaffold)
14. Trading/P2P economy features

## Important Design Notes

### Determinism
- Battle outcomes are **pure functions**: `simulateBattle(characterSnapshot, monsterDef, gambitPage, seed) -> BattleResult`
- Use `Mulberry32` PRNG everywhere, never `Math.random()`
- Same inputs always produce same battle log (byte-for-byte determinism)

### Server Authority
- Client sends **intents** (equip, select map, activate gambit) via REST/WebSocket
- Server computes everything and sends **facts** (battle results, timestamps)
- Frontend animates progress bars from `startAt`/`endAt`, never simulates

### Seemless Idle
- Pre-compute 5 battles ahead in `BattleQueueEntry` rows
- Client can animate for minutes without a request
- Only one resolved job fires every ~15-20s (average battle time)

### Gambit System
- Declarative, not code: "IF self HP < 30% AND has_potion THEN use_potion"
- Server validates all lines at save time (reject invalid references)
- Evaluation is left-to-right, first legal line wins

## Testing

```bash
# Run unit tests
pnpm -r test

# Run with coverage
pnpm -r test:cov

# Watch mode
pnpm -r test:watch

# Lint
pnpm -r lint
```

## Database

### Migrations

```bash
# Generate migration after entity changes
cd apps/api
typeorm migration:generate -n MigrationName

# Run migrations manually
pnpm db:migrate

# Drop all tables (DANGER - dev only)
pnpm db:drop
```

### Reset Database (Dev)

```bash
docker-compose down -v  # Remove volumes
docker-compose up       # Recreate empty db
```

## Debugging

### Backend Logs

```bash
# See full logs with timestamps
docker-compose logs -f backend

# Just backend
docker-compose logs -f api
```

### Database Queries

Set `DB_LOGGING=true` in `.env` to see all TypeORM queries.

### WebSocket Events

Open browser DevTools, then:
```javascript
// In Console, after page loads (when socket connects)
io.on('connect', () => {
  console.log('Socket connected');
});
io.on('disconnect', () => {
  console.log('Socket disconnected');
});
io.onAny((event, ...args) => {
  console.log('Event:', event, args);
});
```

## Common Issues

### Port Already in Use
```bash
# Find what's using port 3000
lsof -i :3000

# Kill it
kill -9 <PID>
```

### Database Connection Failed
```bash
# Check postgres is running
docker-compose logs db

# Wait for postgres to be healthy
docker-compose up -d db
sleep 10
docker-compose up backend
```

### TypeORM Synchronize Warning
- Only use `synchronize: true` in **development**
- For production, always use migrations
- Current setting: `NODE_ENV=development` → synchronize enabled

## CI/CD

A GitHub Actions workflow is included (`deploy-backend.yml` pattern) for:
- Running tests on PR
- Building Docker image
- Deploying to VPS on push to `main`

See `.github/workflows/` for configuration.

## REDE DOCKER

- TEM QUE CRIAR MANUALMENTE A 'rede-compartilhada' no servidor usando 
```bash
docker network create rede-compartilhada
```


## Contributing

1. Create feature branch: `git checkout -b feature/my-feature`
2. Implement with tests
3. Lint: `pnpm -r lint`
4. Run tests: `pnpm -r test`
5. Push and open PR

## License

TBD

## Contact

Project Lead: (TBD)

---

**Last Updated:** September 25, 2026
**Current Status:** Backend structure ~60% complete, Frontend not started, Ready for business logic implementation
