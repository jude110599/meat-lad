import { useEffect } from 'react';
import { GameScene } from './scene/GameScene';
import { attachFriends } from './ui/friends';
import { Hud } from './ui/Hud';
import { Lobby } from './ui/Lobby';
import { joinParty } from './net/session';
import { useGame } from './state/store';

export function App() {
  const screen = useGame((s) => s.screen);
  const ready = useGame((s) => !!s.s);

  useEffect(() => {
    // Arriving from an invite link or a friend's invite: ?join=CODE
    const code = new URLSearchParams(location.search).get('join');
    if (code) joinParty(code);
    attachFriends();
  }, []);

  if (screen === 'lobby' || !ready) return <Lobby />;
  return (
    <>
      <GameScene />
      <Hud />
    </>
  );
}
