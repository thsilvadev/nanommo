# Proposal

## Why

NanoMMO now has split local registration/login and the User model already contains provider/providerId fields reserved for OAuth. This change adds Google OAuth as a first-class authentication method while preserving the existing rule that authentication and character creation are separate steps.

## What Changes

- Add Google OAuth Authorization Code authentication.
- Allow Google authentication from both login and registration.
- Create a User on first successful Google authentication and reuse it on subsequent logins.
- Use Google OIDC subject (sub) as the stable provider identity.
- Never silently merge a Google identity into an existing local account with the same email.
- Reuse the existing NanoMMO JWT/session generation and active-session rotation.
- Treat a validated Google verified email as verified for a Google-created account.
- Do not create a Character automatically; existing character gating remains authoritative.
- Add Google buttons to login/register and a frontend OAuth callback route.
- Use a short-lived, single-use opaque handoff code instead of putting NanoMMO tokens in the Google callback URL.
- Add tests and document Google Cloud Console/environment configuration.

## Explicitly Out of Scope

- Other OAuth providers.
- Automatic character creation.
- Account-linking UI.
- Silent local/Google account merging.
- Changes to gameplay.

## Identity Rules

1. Lookup an existing Google account by provider=google and providerId=Google sub.
2. If no Google identity exists, check the validated Google email against provider=local.
3. A matching local account causes an explicit collision result; no second account and no automatic merge.
4. A new Google account uses provider=google, providerId=sub, the validated email, and emailVerified=true when Google establishes a verified email.
5. Google accounts do not require a NanoMMO password.

## UX

New Google user: Google -> callback -> User creation -> NanoMMO session -> create-character -> play.

Returning Google user: Google -> callback -> existing User -> NanoMMO session -> play if a character exists, otherwise create-character.

Local-account collision: Google -> callback -> clear message telling the player to use the existing local login; no NanoMMO session is issued.

## Security

- Backend-mediated OAuth; Google client secret never reaches Angular.
- Authorization Code flow with state protection and PKCE where supported.
- Validate authorization code and Google OIDC identity server-side.
- Validate issuer, audience, expiration, nonce/state, and Google subject.
- Request only openid, email, profile.
- Never log authorization codes or tokens.
- Rate-limit OAuth entry/callback/handoff endpoints.
- Rotate the normal NanoMMO activeSessionId on successful authentication.

## Impact

Backend: AuthService/OAuth service, auth endpoints, provider-aware user resolution, secure OAuth handoff, configuration and tests.

Frontend: Google actions on login/register, OAuth callback route, handoff exchange, existing character routing, collision/error UX.

Database: reuse existing User.provider/providerId fields; no new account table is required.
