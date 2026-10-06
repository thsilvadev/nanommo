# Design

## Context

The current auth system (see `apps/api/src/modules/auth/auth.service.ts`) implements a single-stage registration: `POST /auth/register` accepts `{username, email, password, cpf}`, creates a `User` with a `username` and `cpfHash`, auto-creates a `Character` using the username as the character name, and returns tokens. Login (`POST /auth/login`) looks up the user by `username` only and currently **rejects unverified emails** (`auth.service.ts:233-235`). The `User` entity (`apps/api/src/database/entities/user.entity.ts`) carries `username` (unique), `cpfHash` (unique), and `email` (unique). The `Character` entity already has a `name` column (denormalized copy of `User.username`) with a 1:1 `userId` unique constraint.

The frontend (`apps/frontend/src/app/features/auth/register.component.ts`) renders a single form with username/email/password/cpf fields. `AuthStore.register()` posts all four fields. Guards (`apps/frontend/src/app/core/auth.guard.ts`) only check `isAuthenticated` — there is no character-existence gate. The Socket.IO gateway (`apps/api/src/modules/gateway/nanommo.gateway.ts:66-103`) already rejects connections when no character exists (`CHARACTER_NOT_FOUND`), so the backend realtime side is already character-gated; only the REST/frontend side is not.

This design covers the backend entity/API changes, the frontend flow/routing changes, and the data migration. See `proposal.md` for motivation and `specs/accounts/auth/spec.md` for the behavioral contract.

## Goals / Non-Goals

**Goals:**
- Split registration into two stages: email+password (creates User) then character name (creates Character)
- Accept character name OR email at login
- Remove CPF and username from the User entity and all flows
- Gate all `/play` access behind character existence (frontend + REST + WebSocket)
- Prepare the User data model for a future Google OAuth provider without implementing it

**Non-Goals:**
- Implementing Google OAuth (only the data-model foundation)
- Changing the battle engine, gambit system, or any gameplay mechanics
- Building an admin panel or moderation tools
- Changing the email verification / password reset token mechanics (they remain as-is)

## Decisions

### D1: Two separate endpoints for the two registration stages

**Decision:** Keep `POST /auth/register` for stage 1 (email + password only) and reuse the existing `POST /characters` (`CharacterController.create`) for stage 2 (character name).

**Rationale:** Stage 2 is semantically character creation, which already lives in `CharacterController` / `CharacterService.createCharacter(userId, name)`. Reusing it avoids duplicating the character-bootstrap logic (default stats, starter inventory, 7 weapon proficiencies, 3 gambit pages). The alternative — a dedicated `POST /auth/register/character` — would duplicate that logic or still delegate to `CharacterService`, adding an endpoint without benefit.

**Changes to `POST /characters`:**
- DTO `CreateCharacterDto` changes from `{ username }` to `{ name }`
- Add an `emailVerified` gate: the controller (or a new `EmailVerifiedGuard`) fetches the `User` from the DB and rejects with **403** if `emailVerified !== true`. This check queries the DB, **not** the JWT claim, because the user's token may still carry `emailVerified = false` from stage 1 even after they click the verification link (the token is only refreshed later). The DB is authoritative.
- Add character-name validation (3–16 chars, alphanumeric, case-sensitive, unique) — see D4.
- Remove the auto-create call from `AuthService.register` (registration no longer creates a character).

### D2: Login identifier resolution via '@' heuristic

**Decision:** `POST /auth/login` accepts `{ identifier, password }`. If `identifier` contains `@`, look up the `User` by `email`; otherwise look up the `Character` by `name` and resolve its `userId`.

**Rationale:** Character names are alphanumeric (no `@`), so the presence of `@` reliably distinguishes an email from a character name. This is deterministic and avoids trying two lookups in sequence. The alternative (always try email first, then fall back to name) adds a second query on every name-login and complicates error handling.

**Implementation:** `AuthService.login` branches on `dto.identifier.includes('@')`. For the name path, query `Character` by `name`, then load the owning `User`. Both paths converge on the same Argon2id verify + session-rotation + token-generation logic.

**Behavior change:** Login no longer rejects unverified users. It succeeds and embeds `emailVerified` in the JWT; the frontend routes unverified users to `/verify-email-pending`. This is required so a user who registered but did not verify can always log back in to reach the resend-verification screen (the resend endpoint requires an authenticated session). The old "Please verify your email before logging in" rejection is removed.

### D3: JWT claims change

**Decision:** The access-token payload changes from `{ userId, username, sessionId, type }` to `{ userId, characterId, emailVerified, sessionId, type }`.

- `username` is removed (the field no longer exists).
- `characterId` is `null` when the user has no character, the character UUID otherwise.
- `emailVerified` mirrors `User.emailVerified` at token-issuance time.

**Rationale:** The gateway (`nanommo.gateway.ts`) currently reads `payload.username` to set `socket.username`. It already fetches the `Character` row from the DB and uses `character.name` for chat, so `socket.username` is not load-bearing for chat. The gateway will set `socket.username` from `character.name` instead of the removed claim. `characterId` and `emailVerified` give the frontend synchronous routing hints without an extra round-trip.

**`generateTokens` refactor:** `AuthService.generateTokens` currently takes `(userId, username, sessionId)`. It is refactored to `(userId, sessionId)` and internally loads the `User` (for `emailVerified`) and the `Character` (for `characterId`, nullable) so every token-issuance path (login, register, refresh) embeds fresh claims. Callers stop passing `username`.

**Stale-claim note:** `characterId`/`emailVerified` in the JWT are hints, not authorization gates. Authorization decisions (character creation gate, game access) query the DB. After character creation the JWT's `characterId` is briefly stale (`null`) until the next refresh; this is harmless because the gateway resolves the character by `userId` from the DB, and the frontend guards use the `CharacterStore` (see D5).

### D4: Character name as the single unique display name

**Decision:** `Character.name` becomes the unique, user-facing name (3–16 chars, alphanumeric, case-sensitive). A unique index is added on `characters.name`. `User.username` is dropped.

**Rationale:** This decouples account identity (email) from character identity (name), which is what makes login-by-name and future OAuth possible. The `Character` entity already has the `name` column; this change promotes it from "denormalized copy of username" to the authoritative name and adds the uniqueness constraint that `User.username` previously held.

**Validation:** Server-side, alphanumeric-only (`/^[a-zA-Z0-9]{3,16}$/`), case-sensitive uniqueness. The frontend create-character form mirrors these rules for immediate feedback, but the server is authoritative.

### D5: Frontend character-existence gating via CharacterStore

**Decision:** The frontend guards use the `CharacterStore` (`apps/frontend/src/app/core/game.store.ts`) as the source of truth for "does this user have a character", not the JWT `characterId` claim.

**Rationale:** `CharacterStore` already loads `GET /characters` (which returns `Character | null`) and caches it in a signal. Using it avoids a token-refresh dance after character creation and is always fresh. The JWT `characterId` claim remains as a backend convenience but is not the guard's authority.

**New guards** (in `apps/frontend/src/app/core/auth.guard.ts`):
- `characterGuard` (for `/play` and children): if not authenticated → `/login`; else ensure the character is loaded (trigger `CharacterStore.load()` if idle) → if `null` → `/create-character`; else allow. Async guard (returns `Observable<boolean | UrlTree>`).
- `createCharacterGuard` (for `/create-character`): if not authenticated → `/login`; else ensure character loaded → if non-null → `/play`; else allow.
- `guestGuard` (for `/login`, `/register`): if not authenticated → allow; else redirect to `/play` (has character) or `/create-character` (no character).

**New route:** `/create-character` loads a new `CreateCharacterComponent` (`apps/frontend/src/app/features/auth/create-character.component.ts`) with a single character-name input, inline validators (length, alphanumeric), and server-error surfacing (duplicate name → 409 message).

**AuthStore changes:** `register(email, password)` (drop username/cpf params); `login(identifier, password)` (rename param); add `createCharacter(name)` posting to `/characters` and storing the returned `CharacterDto` in `CharacterStore`.

### D6: OAuth-ready User data model

**Decision:** Add `provider` (enum `'local' | 'google'`, default `'local'`) and `providerId` (nullable varchar) columns to `User`. Change the email uniqueness from `@Unique(['email'])` to a composite `@Unique(['provider', 'email'])`.

**Rationale:** Scoping email uniqueness by provider lets the same email exist once per provider (a local account and a future Google account may share an email) while preventing duplicates within a provider. For `provider = 'local'`, `providerId` is always `null`. No OAuth logic is implemented in this change — only the columns and the composite constraint, so a later OAuth change is additive.

### D7: Migration strategy

**Decision:** A single TypeORM migration (`apps/api/src/database/migrations/<timestamp>-SplitRegistrationCharacterCreation.ts`) performs:

1. **Data migration first** (before dropping columns): `UPDATE characters SET name = users.username FROM users WHERE characters.userId = users.id AND characters.name IS DISTINCT FROM users.username` — copies existing usernames into character names so no existing player loses their name.
2. Add unique index on `characters.name`.
3. Drop the `cpfHash` column and its unique constraint from `users`.
4. Drop the `username` column and its unique constraint from `users`.
5. Add `provider` (varchar, default `'local'`, not null) and `providerId` (varchar, nullable) to `users`.
6. Drop the old `users.email` unique constraint and add a composite unique on `(provider, email)`.

**Rationale:** The data migration must run before dropping `username`, because `username` is the only source of existing character names. TypeORM migrations run via `RUN_MIGRATIONS=true` (see `app.module.ts:51-52`); in development `synchronize: true` also syncs the entity schema, but the data migration (step 1) only exists in the migration file, so the migration must be run even in dev to preserve existing names. The `down()` reverses the schema changes (it cannot perfectly restore dropped data, which is documented as a limitation).

**Note on `synchronize`:** Because `synchronize: true` in development will apply entity changes automatically, the migration's schema steps are primarily for production/staging. The data-migration step is the critical part that `synchronize` cannot do.

## Risks / Trade-offs

- **[Breaking change for existing deployments]** Dropping `username`/`cpfHash` and adding the composite unique requires the migration to run before the new code serves traffic. → Mitigation: migration runs at boot via `RUN_MIGRATIONS=true`; the data-migration step preserves existing character names. Rollback = run `down()` and redeploy previous code (data migrated into `characters.name` is preserved).
- **[Stale JWT claims]** `characterId`/`emailVerified` in the JWT can be briefly stale after verification or character creation. → Mitigation: authorization gates (character creation, game access) query the DB, never the JWT claim; the JWT claims are frontend routing hints only.
- **[Login behavior change]** Allowing unverified logins means unverified users hold valid tokens. → Mitigation: unverified users have no character, so all gameplay endpoints and the WebSocket gateway already reject them (`CHARACTER_NOT_FOUND`); the only authenticated endpoint they can reach is resend-verification, which is the intended UX.
- **[Name squatting]** Character names are now unique and case-sensitive, so early registrants can claim desirable names. → Mitigation: acceptable for MVP; no name-reservation system is in scope.
- **[Composite unique on (provider, email)]** Existing rows all have `provider = 'local'` after migration, so the composite constraint behaves identically to the old email-unique for existing data. → No data conflict expected; verified by migration ordering (set provider default before adding constraint).

## Migration Plan

1. Write the migration file with the data-migration step first, then schema steps (D7).
2. Update `User` and `Character` entities to match the target schema.
3. Run `RUN_MIGRATIONS=true` against a copy of the production DB in staging; verify existing character names are preserved and no unique-constraint violations occur.
4. Deploy backend (entities + migration + auth/character service changes) and frontend (new routes, guards, components) together — the API contract changes are coordinated (DTO field renames), so a rolling deploy of one side alone would break.
5. Rollback: redeploy previous version and run the migration `down()`. Character names already copied into `characters.name` remain valid (the old code reads `Character.name` for display), so rollback is safe for display; the old `username`-based login would need the `username` column restored by `down()`.

## Open Questions

- None. All decisions are resolved; the OAuth provider implementation is explicitly deferred and does not affect this change's specs, design, or tasks.
