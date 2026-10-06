# Spec Delta

## Purpose

Provides a complete authentication and account management system for NanoMMO, supporting two-stage registration (email/password then character creation), login via character name or email, email verification, password reset, session management, and character existence gating for game access — with a foundation ready for future Google OAuth integration.

## ADDED Requirements

### Requirement: Two-stage registration — Stage 1 (email + password)
The system SHALL allow a new user to create an account by providing only an email address and password. The system SHALL validate that the email is unique, well-formed, and not already registered. The system SHALL validate that the password meets minimum security requirements (minimum 8 characters). The system SHALL create a User record with `emailVerified = false`, `provider = 'local'`, and no character associated. The system SHALL send a verification email containing a time-limited token. The system SHALL NOT require CPF, username, or character name at this stage.

#### Scenario: Successful stage 1 registration
- **WHEN** a client submits a valid, unused email and a password meeting requirements to the stage 1 registration endpoint
- **THEN** the system creates a User with `emailVerified = false`, `provider = 'local'`, returns a success response, and queues a verification email

#### Scenario: Duplicate email rejection
- **WHEN** a client submits an email that already exists in the system
- **THEN** the system rejects the request with a 409 Conflict and a clear error message indicating the email is already registered

#### Scenario: Invalid email format rejection
- **WHEN** a client submits a malformed email address
- **THEN** the system rejects the request with a 400 Bad Request and a validation error

#### Scenario: Weak password rejection
- **WHEN** a client submits a password shorter than 8 characters
- **THEN** the system rejects the request with a 400 Bad Request and a validation error

### Requirement: Email verification
The system SHALL provide a verification endpoint that accepts a token from the verification email. The system SHALL validate the token, ensure it has not expired (24-hour expiry), and ensure it belongs to the correct user. On success, the system SHALL set `emailVerified = true` and consume the token (single-use). The system SHALL redirect the user to the character creation screen (frontend route `/create-character`). The system SHALL NOT allow character creation or game access before email verification is complete.

#### Scenario: Successful email verification
- **WHEN** a user clicks a valid, unexpired verification link
- **THEN** the system marks the user's email as verified, consumes the token, and redirects to `/create-character`

#### Scenario: Expired token rejection
- **WHEN** a user clicks a verification link with an expired token (older than 24 hours)
- **THEN** the system rejects the request with a 400 Bad Request and an error indicating the token has expired, and offers to resend the verification email

#### Scenario: Invalid token rejection
- **WHEN** a user clicks a verification link with an invalid or already-consumed token
- **THEN** the system rejects the request with a 400 Bad Request and an error indicating the token is invalid

### Requirement: Two-stage registration — Stage 2 (character creation)
The system SHALL allow a user with a verified email (`emailVerified = true`) and no existing character to create a character by providing a character name. The system SHALL validate the character name: 3–16 characters, alphanumeric only, case-sensitive, unique across all characters. The system SHALL create a Character record linked to the User (1:1), with default attributes (level 1, 5 in each base attribute, starter inventory). The system SHALL set the Character's `name` field to the provided value. The system SHALL NOT allow a user to create more than one character.

#### Scenario: Successful character creation
- **WHEN** a verified user with no character submits a valid, unique character name
- **THEN** the system creates a Character linked to the User with default starter state and redirects to `/play`

#### Scenario: Duplicate character name rejection
- **WHEN** a user submits a character name that already exists
- **THEN** the system rejects the request with a 409 Conflict and a clear error message

#### Scenario: Invalid character name format rejection
- **WHEN** a user submits a character name with non-alphanumeric characters, or shorter than 3 or longer than 16 characters
- **THEN** the system rejects the request with a 400 Bad Request and a validation error listing the specific format violations

#### Scenario: Unverified email rejection
- **WHEN** a user with `emailVerified = false` attempts to access character creation
- **THEN** the system rejects the request with a 403 Forbidden and redirects to a page prompting email verification

#### Scenario: Existing character rejection
- **WHEN** a user who already has a character attempts to create another
- **THEN** the system rejects the request with a 409 Conflict and redirects to `/play`

### Requirement: Login with character name or email
The system SHALL accept either a character name or an email address as the identifier in the login request, along with a password. The system SHALL look up the User by email (if input contains '@') or by joining User → Character by name (if input does not contain '@'). The system SHALL verify the password hash using Argon2id. On success, the system SHALL issue a JWT access token (~15 min) and a refresh token (~7 days), update `User.activeSessionId` and `User.lastLoginAt`, and embed `sessionId`, `characterId` (null if no character exists), and `emailVerified` in the JWT claims. The system SHALL allow login for users whose email is not yet verified (so they can reach the verification/resend screen); the frontend routes unverified users to `/verify-email-pending`. The system SHALL enforce single active session: a new login invalidates any previous session by rotating `activeSessionId`.

#### Scenario: Login with email
- **WHEN** a user submits their registered email and correct password
- **THEN** the system authenticates the user, issues tokens with `characterId` claim (if character exists), and returns success

#### Scenario: Login with character name
- **WHEN** a user submits their character name (no '@' in input) and correct password
- **THEN** the system finds the User via Character.name, authenticates, issues tokens with `characterId` claim, and returns success

#### Scenario: Login with unverified email
- **WHEN** a user submits valid credentials but their email is not yet verified
- **THEN** the system authenticates the user, issues tokens with `emailVerified = false`, and returns success (the frontend routes the user to `/verify-email-pending`)

#### Scenario: Invalid credentials rejection
- **WHEN** a user submits an unknown identifier or incorrect password
- **THEN** the system rejects with 401 Unauthorized and a generic "invalid credentials" error (no enumeration)

#### Scenario: Account lockout after failed attempts
- **WHEN** a user has 5 consecutive failed login attempts
- **THEN** the system locks the account for 15 minutes, rejects further attempts with 429 Too Many Requests, and tracks via `failedLoginCount`/`lockedUntil` on User

#### Scenario: Session invalidation on new login
- **WHEN** a user logs in from a new device/browser
- **THEN** the system generates a new `activeSessionId`, invalidating any previous session's tokens on next request

### Requirement: Password reset
The system SHALL provide a password reset flow: user requests a reset by email, system sends a time-limited token (1-hour expiry), user submits token + new password, system validates token, hashes new password with Argon2id, updates `passwordHash`, consumes token, and invalidates all existing sessions (rotate `activeSessionId`).

#### Scenario: Successful password reset
- **WHEN** a user submits a valid, unexpired reset token and a new password meeting requirements
- **THEN** the system updates the password hash, consumes the token, invalidates all sessions, and returns success

#### Scenario: Expired reset token rejection
- **WHEN** a user submits a reset token older than 1 hour
- **THEN** the system rejects with 400 Bad Request and an error indicating the token has expired

### Requirement: Character existence gating for game access
The system SHALL require a Character to exist for any access to `/play` routes (gameplay). The system SHALL provide a guard that checks for `characterId` in the authenticated user's JWT (or queries the database). If no character exists, the system SHALL redirect to `/create-character`. This applies to all `/play/*` routes including WebSocket connections to `/game` namespace.

#### Scenario: Authenticated user with character accesses /play
- **WHEN** a logged-in user with an existing character navigates to `/play` or any `/play/*` route
- **THEN** the system allows access and loads the game shell

#### Scenario: Authenticated user without character redirected
- **WHEN** a logged-in user with no character navigates to `/play` or any `/play/*` route
- **THEN** the system redirects to `/create-character`

#### Scenario: Unauthenticated user redirected to login
- **WHEN** an unauthenticated user navigates to `/play` or any `/play/*` route
- **THEN** the system redirects to `/login`

#### Scenario: WebSocket connection without character rejected
- **WHEN** a user attempts to connect to the `/game` Socket.IO namespace without a character
- **THEN** the system rejects the handshake with an authentication error indicating character required

### Requirement: User entity ready for OAuth providers
The system SHALL extend the User entity with `provider` (enum: 'local' | 'google', default 'local') and `providerId` (nullable, stores the OAuth provider's user ID). The system SHALL ensure that for `provider = 'local'`, `providerId` is null. The system SHALL ensure email uniqueness is scoped within provider (i.e., same email can exist for 'local' and 'google' providers, but not twice for 'local'). The system SHALL NOT implement Google OAuth in this change — only the data model preparation.

#### Scenario: Local user has null providerId
- **WHEN** a user registers via email/password (stage 1)
- **THEN** the created User has `provider = 'local'` and `providerId = null`

#### Scenario: Email uniqueness scoped by provider
- **WHEN** attempting to create a local user with an email that exists only for a google user
- **THEN** the system allows creation (different provider)
- **WHEN** attempting to create a local user with an email that exists for another local user
- **THEN** the system rejects with 409 Conflict

### Requirement: Rate limiting on auth endpoints
The system SHALL apply rate limiting to `POST /auth/register` (stage 1), `POST /auth/register/character` (stage 2), `POST /auth/login`, `POST /auth/verify-email`, `POST /auth/forgot-password`, and `POST /auth/reset-password` endpoints. The limit SHALL be 5 attempts per 60 seconds per IP address (TUNABLE).

#### Scenario: Rate limit exceeded
- **WHEN** a client exceeds 5 requests in 60 seconds to any auth endpoint
- **THEN** the system responds with 429 Too Many Requests and a retry-after header

## REMOVED Requirements

### Requirement: CPF collection and validation during registration
**Reason**: CPF is no longer required for registration per product decision. Anti-multi-account will be handled by email verification + future OAuth linking.
**Migration**: Remove `cpfHash` column from `users` table via migration. Remove CPF validation logic from registration endpoint. Remove CPF field from registration DTOs and frontend forms.

### Requirement: Username field on User (used as character name)
**Reason**: Character name is now collected in stage 2 and stored on the Character entity. This decouples account identity from character identity, enabling future OAuth where the provider provides the account identity.
**Migration**: Drop `username` column from `users` table via migration. Add `name` column to `characters` table (unique, 3-16 alphanumeric). Migrate existing usernames to character names for existing users (one-time migration script).