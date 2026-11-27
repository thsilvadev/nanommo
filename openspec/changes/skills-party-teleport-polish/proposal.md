# Light of Heaven on any target, skill range in tooltips, teleport pose, party leader transfer and invite popup

## Why

Light of Heaven was self-only although it is the rods' Holy heal; skill tooltips did not show range; a teleport looked like walking; a party could not change leader; invites were easy to miss in the side panel and could be sent repeatedly.

## Scope

1. `target: "any"` skills (Light of Heaven, range 8): the line's condition scope picks self, ally or foe; Holy heal on Shadow deals the amount as pure damage. Heal sound for it and for Father Marcellus.
2. Range in skill tooltips (mastery and monster skills).
3. Teleport: kneel + blue light column in the arena; kneel in the Character Summary portrait.
4. `PUT /party/leader`; "Make leader" in the party panel.
5. Incoming invite as a popup; one pending invite per inviter/candidate.

## Non-goals

No migration, no deploy, no change to queued battles (their snapshots keep the old skill target).
