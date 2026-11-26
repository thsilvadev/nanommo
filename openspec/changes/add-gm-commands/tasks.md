## 1. Role
- [x] 1.1 Migration `1800800000000-UserRole` (column, check, seed `thiagosauro`)
- [x] 1.2 `User.role` outside ORM reads/writes (no ORM default)
- [x] 1.3 `maintenance/set-user-role <characterName> <gm|player>`

## 2. GM commands
- [x] 2.1 `GmCommand` / `GmSchedulableEvent` contracts, tokenizer, `intArg`
- [x] 2.2 `GmAccessService` (database role, pre-migration = no GM) and `GmService` (`/gm-help`, audit)
- [x] 2.3 Gateway `gm:command`
- [x] 2.4 Cheat commands with a named target; dev cheat URLs unregistered
- [x] 2.5 `/start-event smashing-spree <minutes>` with the countdown that fits

## 3. Frontend
- [x] 3.1 Unknown slash commands go to `gm:command`; answers as System lines
- [x] 3.2 Speech bubbles keep their on-screen size when zooming out

## 4. Validation
- [x] 4.1 `apps/api/test/gm-commands.test.js`
- [x] 4.2 Karma: idle-chat, town runtime (bubble size)
