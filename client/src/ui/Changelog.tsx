/** Starforge's own update history, newest first. Shown in the lobby and the Crew tab. */
export const CHANGELOG: { v: string; when: string; items: string[] }[] = [
  {
    v: '0.4.0',
    when: 'Oct 11, 2026, 7:15 PM UTC',
    items: [
      'Fixed the screen going black. One glitched pixel could spread across the whole view; that can no longer happen. The game also rebuilds the 3D view by itself if your phone drops it (for example after switching apps).',
      'A brand-new asteroid: craters, ridges and rust-and-iron rock with molten cracks that pulse and flare as you tap, purple crystals, a little debris belt, and a squash and wobble when you hit it.',
      'A ringed gas giant with its own moon now hangs in the background, with a richer nebula, twinkling stars and better lighting.',
      'New models: drones with solar panels and blinking lights in your colour, big Harvester haulers with tractor beams, drill-tower Auto-Rigs that spin and plunge, and sleeker crew ships with engine trails.',
      'More effects: brighter lasers with impact flares, sparks and flying rock chunks, ore that flies up to your counter, gold crit bursts, a glowing comet with two tails, upgrade bursts, drifting space dust and a new warp tunnel for Quantum Leap.',
      'A cooler look all round: glassy panels, counters that pop when they grow, shiny buttons that glow when you can afford them, and a flash when you buy.',
      'The Forge Tree is now a glowing star map: gem nodes, energy flowing along unlocked paths, glowing progress rings and a burst when a node unlocks. Labels no longer crowd on phones.',
    ],
  },
  {
    v: '0.3.0',
    when: 'Oct 11, 2026, 4:35 PM UTC',
    items: [
      'A new co-op idea: no more Miner and Refiner roles. Everyone taps the asteroid, buys their own upgrades and builds the same things.',
      'The Forge Tree: 20 big upgrades the whole crew pays into together with ore, alloy and Star Cores. Each one unlocks for everyone, for good, and opens new upgrades (Auto-Rigs, Smelters, Harvesters, Seam Scanners, Alloy Plating), income multipliers and speed-ups. They are expensive on purpose, so choose together.',
      'More of an incremental: drones, harvesters and rigs that mine on their own, ×1 / ×10 / Max buying, outputs that double every 25 levels, and earnings while you are away.',
      'Comets fly past now and then: tap one and the whole crew gets paid, double for you. Breaking seams can trigger crew-wide ore surges later in the tree.',
      'Quantum Leap is personal now: restart your own run for Star Cores that boost all your mining. The Forge Tree stays.',
      'Friends who join your world keep their own progress in it and pick up where they left off next time.',
      'A cleaner, phone-friendly layout: a slim top bar, and Upgrades, Forge Tree and Crew tabs in a bottom sheet (a side panel on bigger screens).',
    ],
  },
  {
    v: '0.2.0',
    when: 'Oct 11, 2026, 3:14 PM UTC',
    items: [
      'Real online co-op for up to 4 players. Host a party and friends join with a 5-letter code or link, with no game server needed.',
      'Friends list: your friends from the main menu show at the bottom left while a party is open, with online dots and an Invite button. Invites pop up wherever your friend is and bring them straight into your party.',
      'Miner and Refiner roles. Miners strike the asteroid; Refiners press machines (keys 1–4) and fire overclocks with power. Pressing right after a strike builds a sync combo up to ×2.',
      'A four-machine refinery chain (Smelter, Plasma Infuser, Dark Compressor, Cosmic Condenser) and upgrades that unlock as your run produces more.',
      'Co-op events: Quakes (strike the nodes, then Stabilize) and Solar Flares (hold the shield up). Win for a big boost; lose and it costs ore or knocks out your drones for a while.',
      'Quantum Leap is a team vote now, with Quantum Points for a permanent skill tree. Your expedition keeps earning at reduced power while you are away.',
      'All-new 3D scene: a lit asteroid with glowing seams and scorch marks, the refinery station with ore streams, drones, teammates’ ships with name tags and emotes, lasers, shockwaves, a flare shield, warp and bloom.',
    ],
  },
  {
    v: '0.1.0',
    when: 'Oct 11, 2026, 3:31 AM UTC',
    items: ['First playable prototype.'],
  },
];

export function Changelog() {
  return (
    <details className="changelog">
      <summary>What’s new · v{CHANGELOG[0].v}</summary>
      {CHANGELOG.map((e) => (
        <section key={e.v}>
          <h4>
            v{e.v} <span>{e.when}</span>
          </h4>
          <ul>
            {e.items.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      ))}
    </details>
  );
}
