/**
 * Mulberry32 - A fast pseudo-random number generator
 * Seed-based for deterministic battle outcomes.
 *
 * SPEC §11.2: "mulberry32 ... must be implemented once in
 * packages/shared/battle-engine/prng.ts and used everywhere randomness is
 * needed in this game (drops, monster selection, hit/crit rolls, equipment
 * attribute rolls) - never Math.random() anywhere in deterministic code paths."
 */
export class Mulberry32 {
  private seed: number;

  constructor(seed: string | number) {
    if (typeof seed === 'string') {
      this.seed = Mulberry32.hashString(seed);
    } else {
      this.seed = seed;
    }
  }

  static hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & 0xffffffff; // Convert to 32bit integer
    }
    return hash >>> 0;
  }

  /**
   * Returns next random number between 0 and 1
   */
  next(): number {
    let t = this.seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  /**
   * Returns random integer between min (inclusive) and max (exclusive)
   */
  nextInt(min: number, max: number): number {
    if (max <= min) return min;
    return Math.floor(this.next() * (max - min)) + min;
  }

  /**
   * Returns random integer in the inclusive range [min, max]
   */
  nextIntInclusive(min: number, max: number): number {
    if (max <= min) return min;
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /**
   * Returns random number between 0 and 100 (useful for percentages)
   */
  nextPercent(): number {
    return this.next() * 100;
  }

  /**
   * Weighted pick from array
   */
  weightedPick<T extends { weight?: number }>(items: T[]): T {
    if (items.length === 0) throw new Error('weightedPick: empty pool');
    const totalWeight = items.reduce((sum, item) => sum + (item.weight ?? 1), 0);
    let pick = this.next() * totalWeight;
    for (const item of items) {
      pick -= item.weight ?? 1;
      if (pick <= 0) return item;
    }
    return items[items.length - 1];
  }

  /**
   * Uniform pick from an array
   */
  pick<T>(items: T[]): T {
    if (items.length === 0) throw new Error('pick: empty pool');
    return items[Math.floor(this.next() * items.length)];
  }

  /**
   * True with probability `chance` (0..1)
   */
  chance(probability: number): boolean {
    if (probability <= 0) return false;
    if (probability >= 1) return true;
    return this.next() < probability;
  }

  /**
   * Create a new PRNG advanced by N positions for subindexing
   */
  fork(index: number): Mulberry32 {
    const forked = new Mulberry32(this.seed);
    const n = Math.max(0, Math.floor(index));
    for (let i = 0; i < n; i++) {
      forked.next();
    }
    return forked;
  }
}

/**
 * SPEC §11.2: seed = mulberry32Seed(`${characterId}:${mapId}:${epoch}`)
 */
export function mulberry32Seed(key: string): number {
  return Mulberry32.hashString(key);
}

/**
 * SPEC §11.2: rngForIndex(index) = mulberry32(seed, index)
 * Pure function: same (seed, index) always -> same stream.
 */
export function rngForIndex(seed: number | string, index: number): Mulberry32 {
  const base = typeof seed === 'string' ? new Mulberry32(seed) : new Mulberry32(seed);
  return base.fork(index);
}
