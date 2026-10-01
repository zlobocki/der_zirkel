const SOUNDS = [
  "/sounds/explosion_after_hit_1.mp3",
  "/sounds/explosion_after_hit_2.mp3",
  "/sounds/explosion_after_hit_3.mp3",
  "/sounds/explosion_after_hit_4.mp3",
  "/sounds/explosion_after_hit_5.mp3",
  "/sounds/explosion_after_hit_6.mp3",
  "/sounds/explosion_after_hit_7.mp3",
  "/sounds/tank_cannon_1.mp3",
  "/sounds/tank_cannon_2.mp3",
  "/sounds/tank_cannon_3.mp3",
];

let context: AudioContext | null = null;
let loading: Promise<AudioBuffer[]> | null = null;

function audioContext(): AudioContext {
  if (!context) {
    context = new AudioContext();
  }
  return context;
}

function loadClips(ctx: AudioContext): Promise<AudioBuffer[]> {
  if (!loading) {
    loading = Promise.all(
      SOUNDS.map(async (url) => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Missing combat sound ${url}`);
        }
        return ctx.decodeAudioData(await response.arrayBuffer());
      }),
    );
  }
  return loading;
}

/** Call from the combat click so later playback is allowed. */
export function armCombatAudio(): void {
  const ctx = audioContext();
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
  void loadClips(ctx).catch(() => {
    loading = null;
  });
}

export async function playCombatSound(): Promise<void> {
  const ctx = audioContext();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  const clips = await loadClips(ctx);
  const clip = clips[Math.floor(Math.random() * clips.length)];
  if (!clip) {
    return;
  }
  const source = ctx.createBufferSource();
  source.buffer = clip;
  source.connect(ctx.destination);
  source.start();
}
