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
  return <button type="button" className="music-toggle" aria-pressed={state.playing}
    aria-label={state.playing ? "Turn music off" : nation ? "Play victory music" : "Turn music on"}
    title={state.playing ? "Stop music" : nation ? "Play victory music" : "Play random background music"}
    onClick={() => {
      const music = player.current;
      if (!music) return;
      if (state.playing) music.stop();
      else if (state.blocked) music.resume();
      else if (nation) music.playVictory(nation);
      else music.playBackground();
    }}>
    <span className="music-label" aria-hidden="true"><span className="music-pilot" />Music</span>
    <span className="music-dial" aria-hidden="true">
      <span className="music-mark music-mark-off">Off</span>
      <span className="music-mark music-mark-on">On</span>
      <span className="music-knob" />
    </span>
  </button>;
}
