# Proposal

## Why

The current registration flow requires username (which becomes the character name), email, password, and CPF all at once. This creates friction for new players and doesn't align with modern auth patterns. We need to: (1) remove CPF as it's no longer required, (2) split registration into two stages (email/password first, then character creation), (3) allow login with either character name or email, and (4) prepare the foundation for future Google OAuth integration.

## What Changes

- **Remove CPF** from registration entirely (no validation, no hashing, no storage)
- **Split registration into two stages**:
  - Stage 1: email + password only (creates User account, sends verification email)
  - Stage 2: character name (creates Character linked to User, after email verification)
- **Remove username field** from User entity — character name lives only on Character
- **Login accepts character name OR email** as identifier
- **Email verification required before character creation** (user must verify email to access create-character screen)
- **Game access gated behind character existence** — `/play` routes redirect to create-character if no character exists
- **Foundation for Google OAuth** — User entity ready for OAuth provider fields, character creation flow reusable

**BREAKING**: User entity schema changes (username removed, CPF removed, OAuth fields added), registration API changes, login API changes, frontend auth flow changes.

## Capabilities

### New Capabilities
- `accounts/auth`: Core authentication system covering registration (two-stage), login (character name or email), email verification, password reset, session management, and character creation gating

### Modified Capabilities
- None (this is the first structured spec for auth; existing SPEC.md section 15 becomes the delta source)

## Impact

**Backend (NestJS/TypeORM):**
- `User` entity: remove `username`, `cpfHash`; add `provider` (enum: 'local' | 'google'), `providerId`, `lastLoginAt`
- `Character` entity: add `name` (unique, 3-16 chars, alphanumeric), ensure 1:1 with User
- Auth module: new registration endpoints (stage1, stage2), updated login endpoint, email verification flow
- JWT: include `characterId` claim when character exists
- Guards: new `CharacterExistsGuard` for `/play` routes

**Frontend (Angular):**
- New routes: `/register` (stage1), `/create-character` (stage2), `/verify-email`
- Updated `/login` to accept character name or email
- Auth flow: register → verify email → create character → play
- Route guards: redirect to `/create-character` if authenticated but no character

**Database:**
- Migration to drop `username`, `cpfHash` from `users` table
- Migration to add `provider`, `providerId`, `lastLoginAt` to `users`
- Migration to add `name` to `characters` (denormalized from old User.username)
- Unique indexes on `characters.name` and `users.email`

**Shared:**
- DTOs for new registration stages, login, character creation
- Validation rules for character name (3-16 chars, alphanumeric, case-sensitive)