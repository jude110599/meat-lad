/**
 * The five-tier resource chain. Each tier is produced by refining the tier
 * below it, so the chain doubles as the game's progression spine.
 */
export const RESOURCES = ['ore', 'alloy', 'plasma', 'darkMatter', 'cosmicEnergy'] as const;
export type ResourceId = (typeof RESOURCES)[number];

export type Wallet = Record<ResourceId, number>;

export interface ResourceDef {
  id: ResourceId;
  name: string;
  /** Hex colour used for HUD pills, particles and seam glow. */
  color: string;
  /** Input tier consumed by the refinery recipe that produces this tier (null for raw ore). */
  input: ResourceId | null;
  /** Units of `input` consumed per unit produced. */
  ratio: number;
}

export const RESOURCE_DEFS: Record<ResourceId, ResourceDef> = {
  ore: { id: 'ore', name: 'Raw Ore', color: '#ffb03a', input: null, ratio: 0 },
  alloy: { id: 'alloy', name: 'Refined Alloy', color: '#cfd6e6', input: 'ore', ratio: 10 },
  plasma: { id: 'plasma', name: 'Exotic Plasma', color: '#4de8ff', input: 'alloy', ratio: 25 },
  darkMatter: { id: 'darkMatter', name: 'Dark Matter Compound', color: '#b07cff', input: 'plasma', ratio: 50 },
  cosmicEnergy: { id: 'cosmicEnergy', name: 'Cosmic Energy', color: '#ffe28a', input: 'darkMatter', ratio: 100 },
};

export function emptyWallet(): Wallet {
  return { ore: 0, alloy: 0, plasma: 0, darkMatter: 0, cosmicEnergy: 0 };
}
