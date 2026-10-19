import { BATTLE_SOUNDS, randomTrack, type BattleKind } from "./audio-library";

let context: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let sequence = 0;
const clips = new Map<string, Promise<AudioBuffer>>();

export function armCombatAudio(): void {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume().catch(() => {});
  } catch { /* Audio is optional on devices without Web Audio. */ }
}

export async function playCombatSound(kind: BattleKind): Promise<void> {
  const ctx = context;
  if (!ctx || ctx.state !== "running") return;
  const url = randomTrack(BATTLE_SOUNDS[kind]);
  if (!url) return;
  const request = ++sequence;
  try {
    let clip = clips.get(url);
    if (!clip) {
      clip = fetch(url).then(async (response) => {
        if (!response.ok) throw new Error("Battle sound unavailable.");
        return ctx.decodeAudioData(await response.arrayBuffer());
      });
      clips.set(url, clip);
    }
    const buffer = await clip;
    if (request !== sequence) return;
    source?.stop();
    source?.disconnect();
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
  } catch { clips.delete(url); }
}

export function stopCombatSound(): void {
  sequence += 1;
  source?.stop();
  source?.disconnect();
  source = null;
}
