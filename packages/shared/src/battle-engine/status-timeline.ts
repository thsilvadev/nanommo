export interface ProjectedStatusStack {
  type: string;
  expiresAtTick: number;
  appliedAtTick?: number;
  sourceSkillId?: string;
  sourceActor?: string;
}

/** Pure projection of a persisted battle's status timeline at one display tick. */
export function projectStatusTimeline(
  snapshotStatuses: unknown,
  persistedEvents: unknown,
  target: 'character' | 'monster',
  displayTick: number,
): Map<string, ProjectedStatusStack[]> {
  const tick = Math.max(0, Math.floor(Number(displayTick) || 0));
  const active = new Map<string, ProjectedStatusStack[]>();
  const snapshots = Array.isArray(snapshotStatuses) ? snapshotStatuses as any[] : [];
  for (const status of snapshots) {
    const id = String(status?.type ?? status?.id ?? '');
    if (!id) continue;
    const expiresAtTick = status?.expiresAtTick == null ? Number.POSITIVE_INFINITY : Number(status.expiresAtTick);
    // Preserve the full opening snapshot during replay. Filtering to displayTick
    // here can erase a historical stack before its logged expiry/removal event is
    // replayed, which may then incorrectly decrement a later independent stack.
    const stack = { ...status, type: id, expiresAtTick } as ProjectedStatusStack;
    active.set(id, [...(active.get(id) ?? []), stack]);
  }
  const events = Array.isArray(persistedEvents) ? persistedEvents as any[] : [];
  // Do not break at a future event: replay the persisted array order among every
  // event eligible at this tick, preserving equal-tick order without sorting logs.
  for (const event of events) {
    const eventTick = Math.max(0, Math.floor(Number(event?.tick ?? 0)));
    if (eventTick > tick || event?.target !== target) continue;
    const id = String(event?.status ?? event?.statusApplied ?? '');
    if (!id) continue;
    const current = active.get(id) ?? [];
    const action = String(event?.action ?? '');
    if (['status_applied', 'status_stack_applied', 'status_refreshed', 'freeze_applied'].includes(action)) {
      const duration = Number(event?.durationTicks ?? 0);
      const expiresAtTick = event?.expiresAtTick != null
        ? Number(event.expiresAtTick)
        : duration > 0 ? eventTick + duration : Number.POSITIVE_INFINITY;
      // Add even already-expired-at-display-time events to preserve chronological
      // identity for later stack-removal events; expiry is filtered after replay.
      const stack: ProjectedStatusStack = {
        type: id,
        expiresAtTick,
        appliedAtTick: Number(event?.appliedAtTick ?? eventTick),
        sourceSkillId: event?.sourceSkillId,
        sourceActor: event?.actor,
      };
      if (action === 'status_refreshed') active.set(id, [stack]);
      else active.set(id, [...current, stack]);
    } else if (action === 'status_ended' || action === 'status_expired') {
      active.delete(id);
    } else if (action === 'status_stack_lessened') {
      const remaining = Math.max(0, Math.floor(Number(event?.remainingStacks ?? event?.stackCount ?? current.length - 1)));
      // Newer simulator events identify the exact expired stack. Older persisted
      // logs only expose the remaining count, so preserve their historical fallback.
      const expiredAt = event?.expiredAtTick == null ? null : Number(event.expiredAtTick);
      const appliedAt = event?.expiredAppliedAtTick == null ? null : Number(event.expiredAppliedAtTick);
      let next = current;
      if (expiredAt !== null || appliedAt !== null) {
        let removed = false;
        next = current.filter(stack => {
          if (removed) return true;
          const matches = (expiredAt === null || stack.expiresAtTick === expiredAt)
            && (appliedAt === null || stack.appliedAtTick === appliedAt);
          if (matches) { removed = true; return false; }
          return true;
        });
      } else next = current.slice(0, remaining);
      active.set(id, next.slice(0, remaining));
    }
  }
  for (const [id, stacks] of active) {
    const alive = stacks.filter(stack => Number(stack.expiresAtTick ?? Number.POSITIVE_INFINITY) > tick);
    if (alive.length) active.set(id, alive); else active.delete(id);
  }
  return active;
}
