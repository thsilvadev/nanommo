# Wearable equipment and combat integration review

The user requested the Superpowers code reviewer before integration. The reviewer worked read-only, independently of the implementation, using the requesting-code-review template. Reviewed ranges: `de6b4d6..939f8ac`, then the committed updates `939f8ac..bafbdec` and `bafbdec..1a4fc22`. Uncommitted changes in the official checkout were excluded and preserved.

## Findings and disposition

- **P2, town gear retry:** a rejected gear load still recorded `dressedKey`, so identical later roster updates never retried. Fixed in `0bc75a0`: retain the previous outfit and do not settle its key after a failed download. A real-asset browser regression first failed with one load/no gear, then passed with the retry and one fused mesh.
- No Critical findings or additional Important findings in the two supplemental ranges. The reviewer checked public roster fields, fused mesh/cache lifecycle, manifest coverage, structural configuration equality, fitting and cache changes. For the latest committed assets, floating-point accessors are finite, the manifest content version matches, and fitting rejects an unexpected thigh-plate count.
- Subjective fit and the documented small dark plate artifacts were outside the code verdict; the user had reviewed the visual feature separately. Production deployment and license clearance were outside this local integration request. No claims about production browser performance were inferred from software-rendered tests.

## Hunting regression found during integration

The user correctly clarified that Gathering progresses in either stationary stance, so the gauge stays unchanged. Reproduction with the real queue generator and encounter clock showed a Gathering reservation ten minutes in the future surviving a switch to Hunting. Deleting only its simulation rows recreated the same distant deadline.

`12cfb87` cancels the old solo reservation inside the existing stance transaction only when the stance actually changes and no encounter has started. The new queue uses the ordinary seeded search delay. Same-stance requests and started/overdue encounters preserve their identity. The regression also checks generated Gathering journal jobs, the real journal message templates (including Mudcrawler), and suppression after switching to Hunting. Storage/Redis are represented by local fakes; no live game character or production database was modified.

## Integration verification

The combined frontend suite passed 401 tests before rebasing the corrections onto the final reviewed `1a4fc22` snapshot. The final reviewed snapshot also passed 401/401 frontend tests, full builds, spec typechecking, 32/32 asset-pipeline tests and 14 relevant backend regression scripts. Detailed results are recorded in STATUS.md.

Three old component fixtures required explicit timer/action service doubles. Exhaustive real-WebGL tests for five towns and every appearance variant now have per-test deadlines appropriate to those workloads; all assertions remain intact. The public item-name mirror was regenerated from the already-committed canonical catalogue.

An additional legacy `grind-monster-expansion-chat-journal.test.js` run stops in its unrelated catalogue section because it expects `treant.elementalResistances.includes(...)`, a field absent under the current elemental schema. That file and the monster catalogue are unchanged by this patch. Journal scheduling/delivery and exact message templates are covered independently by `stance-search-restart.test.js`; the old script is not reported as passing.

## Integration control

Changes are isolated in `codex/review-integration-fixes`, based on reviewed main snapshot `1a4fc22`. Corrections were prepared entirely in the isolated worktree. Only the subsequently approved local integration updates official main; deployment and database remain untouched. The user initially required a new approval before merging into official main and subsequently granted it explicitly. The later `d9ecbf7` item-name commit was reconciled without conflicts, its public mirror synchronized, and the merged result passed all 401 frontend tests and full builds again. Local fast-forward integration is authorized; no push or deployment is included.
