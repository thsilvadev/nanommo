# Tasks

## 1. Data Model & Migration

- [ ] 1.1 Update `User` entity (`apps/api/src/database/entities/user.entity.ts`): remove `username` and `cpfHash` columns and their `@Unique` decorators; add `provider` (enum `'local'|'google'`, default `'local'`) and `providerId` (nullable varchar); change `@Unique(['email'])` to `@Unique(['provider', 'email'])`. Verify the entity compiles (`npx tsc --noEmit` in apps/api).
- [ ] 1.2 Add a unique index on `Character.name` in `apps/api/src/database/entities/character.entity.ts` (`@Unique(['name'])`). Verify the entity compiles.
- [ ] 1.3 Write TypeORM migration `apps/api/src/database/migrations/<timestamp>-SplitRegistrationCharacterCreation.ts` whose `up()` (in order): copies `users.username` into `characters.name` for existing rows, adds unique index on `characters.name`, drops `users.cpfHash` and its unique constraint, drops `users.username` and its unique constraint, adds `users.provider` (default `'local'`) and `users.providerId`, drops the old `users.email` unique constraint and adds composite unique on `(provider, email)`; `down()` reverses the schema steps. Verify the migration file is syntactically valid TypeScript.
- [ ] 1.4 Run the migration against a seeded dev DB (`RUN_MIGRATIONS=true`) and verify existing character names are preserved (query `characters.name` matches prior `users.username`) and no unique-constraint violation occurs.

## 2. Shared DTOs

- [ ] 2.1 Update `RegisterDto` in `packages/shared/src/dto/index.ts` to `{ email, password }` (remove `username`, `cpf`). Verify shared package compiles.
- [ ] 2.2 Update `LoginDto` to `{ identifier, password }` (rename `username` → `identifier`). Verify shared package compiles.
- [ ] 2.3 Update `CreateCharacterDto` to `{ name }` (rename `username` → `name`). Verify shared package compiles.
- [ ] 2.4 Update the JWT payload type (`UserPayload` in `apps/frontend/src/app/core/auth.store.ts` and any backend payload typing) to carry `characterId: string | null` and `emailVerified: boolean` instead of `username`. Verify both apps compile.

## 3. Backend Auth Service

- [ ] 3.1 Refactor `AuthService.register` (`apps/api/src/modules/auth/auth.service.ts`) to stage 1: accept only `{ email, password }`, validate email format/uniqueness and password length (≥8), create `User` with `provider='local'`, `providerId=null`, `emailVerified=false`, generate verification token, send verification email, and return tokens — with NO character auto-creation and NO CPF handling. Verify a unit/integration test registers a user and asserts no `Character` row is created.
- [ ] 3.2 Refactor `AuthService.login` to accept `{ identifier, password }`: branch on `identifier.includes('@')` to look up by email or by `Character.name`→`userId`, verify Argon2id password, allow unverified users (remove the `emailVerified` rejection), rotate `activeSessionId`, update `lastLoginAt`, and return tokens. Verify tests for login-by-email and login-by-character-name both pass.
- [ ] 3.3 Refactor `AuthService.generateTokens` to signature `(userId, sessionId)` and internally load the `User` (for `emailVerified`) and `Character` (for `characterId`, nullable), embedding `{ userId, characterId, emailVerified, sessionId, type }` and removing the `username` claim. Verify the issued access token decodes with the new claims and no `username` claim.
- [ ] 3.4 Update `AuthService.refresh` to call the new `generateTokens(userId, sessionId)` signature. Verify the refresh flow still returns valid tokens with fresh `characterId`/`emailVerified` claims.
- [ ] 3.5 Remove the `hashCpf` method and all CPF references from `auth.service.ts`. Verify no CPF references remain (`grep -ri cpf apps/api/src`).

## 4. Backend Character Controller

- [ ] 4.1 Add an email-verification gate to `POST /characters` (`apps/api/src/modules/character/character.controller.ts`): fetch the authenticated `User` from the DB and throw 403 Forbidden if `emailVerified !== true` (DB check, not JWT claim). Verify a test with an unverified user receives 403.
- [ ] 4.2 Add character-name validation in `CharacterService.createCharacter`: reject names not matching `/^[a-zA-Z0-9]{3,16}$/` with 400, and reject duplicate names (unique constraint / explicit check) with 409. Verify tests for invalid format and duplicate name both pass.
- [ ] 4.3 Update `CharacterController.create` to pass `dto.name` (not `dto.username`) to `CharacterService.createCharacter`. Verify the create-character endpoint returns a `CharacterDto` with the submitted name.

## 5. Backend Gateway

- [ ] 5.1 In `apps/api/src/modules/gateway/nanommo.gateway.ts`, replace `socket.username = payload.username` with `socket.username = character.name` (the character is already fetched in the auth middleware). Verify the gateway compiles and chat still emits `character.name`.
- [ ] 5.2 Verify the gateway still rejects WebSocket handshakes with `CHARACTER_NOT_FOUND` when the authenticated user has no character (existing behavior, now reachable for unverified/no-character users).

## 6. Frontend Auth Store

- [ ] 6.1 Update `AuthStore.register` (`apps/frontend/src/app/core/auth.store.ts`) to `register(email, password)` posting `{ email, password }` to `/auth/register`. Verify the store compiles.
- [ ] 6.2 Update `AuthStore.login` to `login(identifier, password)` posting `{ identifier, password }` to `/auth/login`. Verify the store compiles.
- [ ] 6.3 Add `AuthStore.createCharacter(name)` posting `{ name }` to `/characters`, and on success store the returned `CharacterDto` in `CharacterStore` (via `CharacterStore` injection or an event) so guards see the character immediately. Verify the method compiles and stores the character.
- [ ] 6.4 Update `AuthStore` routing helpers so that after login, unverified users (`userPayload().emailVerified === false`) are routed to `/verify-email-pending` and verified users without a character are routed to `/create-character`. Verify the routing logic covers all three states (verified+character, verified+no-character, unverified).

## 7. Frontend Guards

- [ ] 7.1 Add `characterGuard` in `apps/frontend/src/app/core/auth.guard.ts`: if not authenticated → `/login`; else ensure `CharacterStore` is loaded (trigger load if idle) → if character is `null` → `/create-character`; else allow. Verify an authenticated user without a character is redirected to `/create-character`.
- [ ] 7.2 Add `createCharacterGuard`: if not authenticated → `/login`; else ensure character loaded → if character exists → `/play`; else allow. Verify an authenticated user with a character is redirected to `/play` when visiting `/create-character`.
- [ ] 7.3 Update `guestGuard` to redirect authenticated users to `/play` (has character) or `/create-character` (no character) instead of always `/play`. Verify an authenticated user without a character is redirected to `/create-character` when visiting `/login`.

## 8. Frontend Components

- [ ] 8.1 Update `RegisterComponent` (`apps/frontend/src/app/features/auth/register.component.ts`): remove the username and CPF form fields, keep email + password, call `authStore.register(email, password)`, and on success navigate to `/verify-email-pending`. Verify the rendered form contains only email and password inputs.
- [ ] 8.2 Update `LoginComponent` to a single `identifier` field (label "E-mail ou nome do personagem") + password, calling `authStore.login(identifier, password)`. Verify the form accepts either an email or a character name.
- [ ] 8.3 Create `CreateCharacterComponent` (`apps/frontend/src/app/features/auth/create-character.component.ts`) with a character-name input (minlength 3, maxlength 16, alphanumeric pattern), inline validation messages, a submit button calling `authStore.createCharacter(name)`, server-error surfacing (409 duplicate → "Nome já em uso"), and on success navigate to `/play`. Verify the component renders the input and shows format/duplicate errors.

## 9. Frontend Routing

- [ ] 9.1 Add a `/create-character` route in `apps/frontend/src/app/app.routes.ts` loading `CreateCharacterComponent` with `canActivate: [createCharacterGuard]`. Verify the route is reachable only for authenticated users without a character.
- [ ] 9.2 Update the `/play` route (and children) to `canActivate: [characterGuard]` (replacing `authGuard`). Verify `/play` redirects to `/create-character` for authenticated users without a character and to `/login` for unauthenticated users.
- [ ] 9.3 Update `/login` and `/register` routes to use the updated `guestGuard`. Verify authenticated users are redirected appropriately based on character existence.

## 10. Tests & Integration Verification

- [ ] 10.1 Backend test: stage-1 registration creates a `User` with `emailVerified=false`, `provider='local'`, no `Character`, and sends a verification email. Verify the test passes.
- [ ] 10.2 Backend test: login succeeds with email and with character name, returns tokens carrying `characterId` and `emailVerified` claims, and allows unverified users. Verify both login paths pass.
- [ ] 10.3 Backend test: `POST /characters` returns 403 for unverified users, 400 for invalid name format, 409 for duplicate name, and 200 with starter inventory/weapon proficiencies/gambit pages for a valid verified user. Verify all four cases pass.
- [ ] 10.4 Frontend test: guards route correctly across the three states (unauthenticated → `/login`; authenticated+no-character → `/create-character`; authenticated+character → `/play`). Verify the guard tests pass.
- [ ] 10.5 End-to-end verification: register (email+password) → verify email → create character → access `/play` and connect the `/game` WebSocket; confirm game access is blocked before character creation and works after. Verify the full flow completes without errors.
