/** A baseline can only be a chronological prefix of the known migration chain. */
export function selectAuditedBaselinePrefix(registeredNames: string[], baselineThroughName: string, maxBaselineTimestamp = 1798000000000): Array<{name:string,timestamp:number}> {
  const ordered = registeredNames.map(name => {
    const match = String(name).match(/(\d{13})$/);
    if (!match) throw new Error(`Migration name has no 13-digit timestamp suffix: ${name}`);
    return { name: String(name), timestamp: Number(match[1]) };
  }).sort((a,b) => a.timestamp-b.timestamp || a.name.localeCompare(b.name));
  const lastIndex = ordered.findIndex(migration => migration.name === baselineThroughName);
  if (lastIndex < 0) throw new Error(`Unknown migration baseline boundary: ${baselineThroughName}`);
  if (ordered[lastIndex].timestamp > maxBaselineTimestamp) {
    throw new Error(`Refusing to baseline new migrations at/after ${maxBaselineTimestamp + 1}; this tool may only record an audited legacy schema prefix.`);
  }
  return ordered.slice(0,lastIndex+1);
}
