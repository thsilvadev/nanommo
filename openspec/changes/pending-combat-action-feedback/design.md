# Design

Approved design: docs/superpowers/specs/2026-11-22-pending-actions-ux-design.md.
One tracker records clientRequestId before sending, then reconciles server intent IDs, safe target metadata and terminal statuses. Socket notifications and bounded recovery polling run only for pending/uncertain work. Lost HTTP replies retry with the same request ID; an omitted action never means success. Pending markers restore from the server independently of component lifetimes. All pending rows are returned even when terminal history is capped.

Character and inventory confirmation reads expose the read revision; markers retire only after the rendered stores reach those revisions. The ordinary load signatures retain their prior behavior. Gambit draft baselines distinguish the save submitted by an old editor instance from newer local edits. Equipment source instance and affected hand slots remain identifiable.

Markers are 12px, muted amber and stationary while queued; submission alone spins, honoring reduced motion. Attributes may add a small caption. Native tooltip/aria labels carry details and reasons. Applied equipment, Diet and active page stay authoritative. Mastery/refinement are not durable-intent types and retain their existing direct mutation UI.
