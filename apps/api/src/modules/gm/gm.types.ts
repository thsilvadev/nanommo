/**
 * GM commands: typed in chat as `/<name> <arg> <arg>...` by an account with
 * role 'gm'. Adding one = a class implementing GmCommand under ./commands,
 * listed in GM_COMMAND_CLASSES (gm.module.ts). Nothing else changes: the
 * gateway, the parser, the access check, the audit log and `/gm-help` are shared.
 */

/** Who runs the command (already checked to be a GM). */
export interface GmContext {
  userId: string;
  characterId: string;
  characterName: string;
}

export interface GmCommand {
  /** Typed after the slash, lowercase with dashes: `start-event`. */
  readonly name: string;
  /** Argument syntax shown by /gm-help: `<event-code> <minutesToEvent>`. */
  readonly usage: string;
  readonly summary: string;
  /** Returns the text shown to the GM; throw GmCommandError for a usage/target problem. */
  run(args: string[], ctx: GmContext): Promise<string>;
}

/** A problem the GM should read as-is (bad arguments, unknown target). */
export class GmCommandError extends Error {}

/**
 * A server event a GM can start with `/start-event <code> <minutesToEvent>`.
 * Each event module provides one and lists it in GM_EVENT_CLASSES (gm.module.ts).
 */
export interface GmSchedulableEvent {
  /** Typed by the GM: `smashing-spree`. */
  readonly code: string;
  readonly name: string;
  /** Schedules the event (countdown announcements included); throws GmCommandError when it can't. */
  schedule(minutesToStart: number): Promise<{ startsAt: number; endsAt: number; announcements: number[] }>;
}

export const GM_COMMANDS = Symbol('GM_COMMANDS');
export const GM_EVENTS = Symbol('GM_EVENTS');

/** Splits a command line on spaces; "double quotes" keep a name with spaces together. */
export function tokenizeGmLine(line: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  for (let m = re.exec(line); m; m = re.exec(line)) tokens.push(m[1] ?? m[2]);
  return tokens;
}

/** Parses a whole-number argument or throws a GmCommandError naming it. */
export function intArg(value: string | undefined, label: string, min: number, max: number): number {
  const n = Number(value);
  if (value === undefined || !/^-?\d+$/.test(value) || n < min || n > max) throw new GmCommandError(`${label} must be a whole number from ${min} to ${max}`);
  return n;
}
