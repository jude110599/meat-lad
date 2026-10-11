/** Starforge's own update history, newest first. Shown in the lobby and the ☰ menu. */
export const CHANGELOG: { v: string; when: string; items: string[] }[] = [
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
