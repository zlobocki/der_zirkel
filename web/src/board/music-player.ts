import { BACKGROUND_MUSIC, VICTORY_MUSIC, randomTrack } from "./audio-library";
export type MusicState = { playing: boolean; blocked: boolean };

export class MusicPlayer {
  private audio = new Audio();
  private pool: string[] = [];
  private background = false;
  private previous: string | undefined;
  private generation = 0;
  constructor(private onState: (state: MusicState) => void) {
    this.audio.preload = "none";
    this.audio.onended = () => {
      if (this.background) this.next();
      else this.onState({ playing: false, blocked: false });
    };
    this.audio.onerror = () => this.onState({ playing: false, blocked: false });
  }
  playBackground(): void {
    this.background = true;
    this.pool = BACKGROUND_MUSIC;
    this.audio.volume = 0.25;
    this.next();
  }
  playVictory(nation: string): void {
    this.background = false;
    this.pool = VICTORY_MUSIC[nation] ?? [];
    this.audio.volume = 0.4;
    this.next();
  }
  private next(): void {
    this.stop();
    const track = randomTrack(this.pool, this.previous);
    if (!track) return;
    this.previous = track;
    this.audio.src = track;
    this.resume();
  }
  resume(): void {
    const generation = ++this.generation;
    void this.audio.play().then(() => {
      if (generation === this.generation) this.onState({ playing: true, blocked: false });
    }).catch((error: unknown) => {
      if (generation === this.generation) this.onState({ playing: false, blocked: error instanceof Error && error.name === "NotAllowedError" });
    });
  }
  stop(): void {
    this.generation += 1;
    this.audio.pause();
    this.onState({ playing: false, blocked: false });
  }
  dispose(): void {
    this.stop();
    this.audio.onended = null;
    this.audio.onerror = null;
    this.audio.removeAttribute("src");
    this.audio.load();
  }
}
