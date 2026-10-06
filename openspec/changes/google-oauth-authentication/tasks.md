# Tasks

## 1. OpenSpec / architecture
- [x] Confirm current auth implementation and preserve split-registration/character-gating rules.
- [x] Select a maintained Google OAuth/OIDC library compatible with current NestJS/Node.
- [x] Choose Redis-backed storage for OAuth state and one-time handoff data.

## 2. Backend
- [x] Add validated Google OAuth configuration.
- [x] Add /auth/google entry and callback endpoints.
- [x] Implement state and PKCE handling.
- [x] Validate Google OIDC issuer, audience, expiration, nonce/state, sub, email and verified-email state.
- [x] Resolve existing provider=google users.
- [x] Create first-time Google users without a password and without a Character.
- [x] Detect local-account email collision without automatic linking.
- [x] Reuse JWT/session generation, activeSessionId rotation and lastLoginAt.
- [x] Implement short-lived single-use opaque handoff codes.
- [x] Rate-limit OAuth endpoints.
- [ ] Add sanitized security logging and tests.

## 3. Frontend
- [x] Add Continue with Google to login and registration.
- [x] Add /auth/google/callback.
- [x] Exchange the handoff through AuthStore.
- [x] Route to /create-character or /play using existing character gating.
- [x] Add clear local-login guidance for collision and safe failure states.

## 4. Google / documentation
- [x] Document development and production redirect URIs.
- [x] Document environment variables and secret handling.
- [x] Document exact Google Cloud Console configuration.
- [ ] Test with a real staging OAuth client.

## 5. Verification
- [x] openspec validate google-oauth-authentication --strict
- [x] shared build
- [x] API build
- [x] frontend build
- [ ] focused OAuth/auth tests
- [x] git diff --check
