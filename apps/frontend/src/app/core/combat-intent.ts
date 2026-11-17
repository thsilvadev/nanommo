/** Existing combat mutation endpoints may acknowledge a durable action before it runs. */
export interface CombatIntentResponse {
  intent?: { id: string; status: 'pending'|'applied'|'failed'|'cancelled'; result?: {message?: string}; message?: string };
}
export function combatIntentStatus(response: CombatIntentResponse | null | undefined): 'pending'|'applied' {
  const intent = response?.intent;
  if (!intent || intent.status === 'applied') return 'applied';
  if (intent.status === 'pending') return 'pending';
  const message = intent.result?.message ?? intent.message ?? 'Action failed';
  throw Object.assign(new Error(message), { error: { message } });
}
