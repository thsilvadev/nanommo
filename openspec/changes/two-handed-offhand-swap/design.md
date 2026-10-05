# Design

- Keep weapon legality server-authoritative in EquipmentService.
- Treat Greatsword, Bow, Staff, and Wand as two-handed.
- An off-hand equip request against an active two-handed main-hand clears mainHand.
- A two-handed main-hand equip request clears offHand.
- A shield may remain equipped with an empty mainHand, because this is the resulting state explicitly required by the swap behavior.
- During Grind, represent the conflicting slot removal as a pending equipment change with value null; applyPendingEquipmentChanges must interpret null as desequip-and-return-to-inventory.
- Existing valid one-handed combinations remain unchanged.
