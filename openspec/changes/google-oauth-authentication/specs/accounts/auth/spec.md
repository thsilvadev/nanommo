# Google OAuth Authentication

## ADDED Requirements

### Requirement: Start Google OAuth
The system MUST expose a backend Google OAuth entry point.

#### Scenario: User selects Google
- WHEN an unauthenticated user selects Continue with Google
- THEN the backend starts Authorization Code authentication with state and the configured Google client.

## Requirement: Secure callback
The callback MUST validate state and the Google OIDC identity before issuing a NanoMMO session.

#### Scenario: Valid callback
- WHEN Google returns a valid authorization code and matching state
- THEN the backend exchanges and validates the identity and continues account resolution.

#### Scenario: Invalid state
- WHEN state is missing, expired, or mismatched
- THEN authentication is rejected and no NanoMMO session is issued.

## Requirement: New Google account
#### Scenario: First authentication
- WHEN a valid Google sub has no existing Google User and no local User owns the validated email
- THEN create provider=google, providerId=sub, the validated email, and emailVerified=true when Google establishes a verified email
- AND issue the normal NanoMMO session
- AND do not create a Character.

## Requirement: Returning Google account
#### Scenario: Existing identity
- WHEN provider=google and providerId=sub matches an existing User
- THEN authenticate that User
- AND rotate activeSessionId
- AND update lastLoginAt
- AND issue the normal NanoMMO session.

## Requirement: Local account collision
#### Scenario: Same email as local account
- WHEN a validated Google email belongs to provider=local and the Google sub is not linked
- THEN do not create a second User
- AND do not automatically link accounts
- AND issue no NanoMMO session
- AND return a clear collision result directing the user to local login.

## Requirement: Character gating
#### Scenario: No character
- WHEN Google authentication succeeds for a User without a Character
- THEN route the user to /create-character.

#### Scenario: Character exists
- WHEN Google authentication succeeds for a User with a Character
- THEN route the user to /play.

## Requirement: One-time handoff
#### Scenario: Successful callback
- WHEN Google authentication succeeds
- THEN create a short-lived, single-use opaque handoff code
- AND redirect to the frontend callback with that code only
- AND never place NanoMMO access/refresh tokens in the URL.

#### Scenario: Handoff replay
- WHEN an expired or already-consumed handoff is redeemed
- THEN reject it and issue no session.

## Requirement: Credential secrecy
The Google client secret MUST remain backend-only and Google credentials MUST NOT be logged.

## Requirement: OAuth scopes
The flow MUST request only openid, email, and profile unless a future requirement explicitly expands the scope.

## Requirement: Safe failure
#### Scenario: User cancels
- WHEN Google returns an OAuth cancellation/error
- THEN do not create or modify a User and do not issue a session
- AND return a non-sensitive result to the frontend.
