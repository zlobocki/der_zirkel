import { useEffect, useRef, useState } from "react";
import type { BoardView } from "../api";
import { endingNation } from "./audio-library";
import { MusicPlayer, type MusicState } from "./music-player";

export function GameMusic({ board }: { board: BoardView | null }) {
  const player = useRef<MusicPlayer | null>(null);
  const [state, setState] = useState<MusicState>({ playing: false, blocked: false });
  const nation = board ? endingNation(board) : null;
  useEffect(() => {
    const music = new MusicPlayer(setState);
    player.current = music;
    return () => { music.dispose(); player.current = null; };
  }, []);
  useEffect(() => { if (nation) player.current?.playVictory(nation); }, [nation]);
  return <button type="button" className="quiet music-toggle" aria-pressed={state.playing}
    title={state.playing ? "Stop music" : nation ? "Play victory music" : "Play random background music"}
    onClick={() => {
      const music = player.current;
      if (!music) return;
      if (state.playing) music.stop();
      else if (state.blocked) music.resume();
      else if (nation) music.playVictory(nation);
      else music.playBackground();
    }}>
    <span aria-hidden="true">♫</span> {state.playing ? "Music off" : nation ? "Play victory music" : "Music on"}
  </button>;
}
