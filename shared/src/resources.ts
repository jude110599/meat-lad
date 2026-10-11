/**
 * Every player keeps their own wallet. Ore is mined, alloy is refined from a
 * share of the ore you mine once you own a Smelter, and Star Cores come from
 * a Quantum Leap: each one boosts all your income until you spend it.
 */
export const RESOURCES = ['ore', 'alloy', 'cores'] as const;
export type ResourceId = (typeof RESOURCES)[number];

export type Wallet = Record<ResourceId, number>;

export interface ResourceDef {
  id: ResourceId;
  name: string;
  /** Hex colour used for HUD pills, particles and node progress. */
  color: string;
}

export const RESOURCE_DEFS: Record<ResourceId, ResourceDef> = {
  ore: { id: 'ore', name: 'Ore', color: '#ffb03a' },
  alloy: { id: 'alloy', name: 'Alloy', color: '#7fe3ff' },
  cores: { id: 'cores', name: 'Star Cores', color: '#ffe28a' },
};

export function emptyWallet(): Wallet {
  return { ore: 0, alloy: 0, cores: 0 };
}
