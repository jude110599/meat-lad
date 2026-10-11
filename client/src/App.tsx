import { useEffect, useState } from 'react';
import { connect, type Authority } from './net/authority';
import { GameScene } from './scene/GameScene';
import { Hud } from './ui/Hud';
import { useGame } from './state/store';

export function App() {
  const [auth, setAuth] = useState<Authority | null>(null);
  const ready = useGame((s) => s.ready);

  useEffect(() => {
    let alive = true;
    void connect().then((a) => alive && setAuth(a));
    return () => {
      alive = false;
    };
  }, []);

  if (!auth || !ready) return <div className="boot">Spinning up the drill…</div>;
  return (
    <>
      <GameScene auth={auth} />
      <Hud auth={auth} />
    </>
  );
}
