# Subtle queued combat action feedback

Approved by the user on 2026-11-22 following the investigation and UX proposal.

Character combat mutations use existing durable intents and immutable battle deadlines. Show a small spinner only during HTTP submission, a stationary amber clock while queued, and a neutral confirmation indicator while disconnected or reconciling. Applied state is displayed only after authoritative data is received; failed/cancelled actions expose the reason locally and permit retry. Never claim an exact next-battle deadline or clear a pending command because a local timeout elapsed.

One shared tracker survives navigation, restores all pending actions after reload and correlates them by intent/client request ID. Target metadata identifies equipment slot and exact inventory instance, consumable type, Gambit page/save version and attribute allocation. Only duplicate/conflicting operations are blocked, with the rest of the interface usable. Existing equipment, Diet, quantities and active Gambit stay authoritative. Food eligibility is checked before queue insertion and again at execution.

Use a 10–12px muted amber marker with native accessible tooltip, no bright pulsing, no full-screen loader, reduced-motion support. Track newer Gambit drafts independently from the save already queued. No database migration, balance change, main merge, push or deployment. Existing HUD and bugfix commits stay separate.
