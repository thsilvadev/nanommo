# Design

## D1 — Backend-mediated OAuth

Angular starts authentication through a backend /auth/google endpoint. Google redirects to a backend callback. The backend validates Google, resolves/creates the NanoMMO User, creates the normal NanoMMO session context, then redirects to the Angular callback.

The Google client secret is backend-only.

## D2 — State and authorization code

Use a maintained OAuth/OIDC library compatible with the current Node/NestJS runtime. Use Authorization Code flow, cryptographically random state, and PKCE where supported. Reject missing, expired, or mismatched state.

Do not hand-roll Google JWT signature verification when the selected maintained library can perform it.

## D3 — Provider identity

Persist Google sub in User.providerId and scope lookup by provider=google. Email is collision metadata, not the Google identity key.

## D4 — Local email collision

If provider=local already owns the validated Google email, stop authentication with a frontend-safe collision result. Do not create a duplicate account and do not link automatically. Account linking is a future feature.

## D5 — Google email verification

For a validated Google OIDC identity, accept Google's verified-email claim as sufficient for emailVerified=true. Do not send the local verification email for a Google-created account.

If verification cannot be established, do not grant character creation based only on the Google email.

## D6 — Existing NanoMMO session

After identity resolution, reuse the existing token/session generation path. It must rotate activeSessionId and update lastLoginAt. Do not duplicate JWT generation inside the Google implementation.

## D7 — Secure browser handoff

Never put NanoMMO access or refresh tokens in the Google callback query string.

Use a short-lived, cryptographically random, single-use opaque handoff code stored server-side. The backend redirects to the Angular callback with only that code. Angular exchanges it over HTTPS for the normal NanoMMO auth response. The handoff expires quickly (for example 60 seconds), is bound to the OAuth transaction, and cannot be redeemed twice.

Redis is preferred for this ephemeral state because the project already uses it; PostgreSQL is acceptable if the implementation has a strong reason.

## D8 — Frontend routing

Add /auth/google/callback. On success, redeem the handoff and hydrate auth/character state. Route to /create-character when no Character exists and /play otherwise. The callback itself is not an authorization boundary; existing guards remain authoritative.

## D9 — Login and registration

Show the same Continue with Google action on /login and /register. There is one Google authentication flow: first use creates the account, later use logs in.

## D10 — Configuration

Backend variables should include GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_OAUTH_CALLBACK_URL, and the frontend callback/return URL as required by the chosen implementation. Secrets are never committed.

Development and production should preferably use separate Google OAuth clients.

## Testing

Cover state/PKCE, callback validation, new-user creation, repeat login, local-email collision, verified-email handling, session rotation, handoff creation/redemption/replay/expiry, cancellation/failure, no-character routing, and absence of Google secrets from frontend output.
