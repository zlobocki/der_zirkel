let context: AudioContext | null = null;

/** Unlock audio during an interaction, including login and lobby clicks. */
export function armTurnAudio(): void {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume().catch(() => {});
  } catch {
    // Audio is optional on devices without Web Audio support.
  }
}

export function playTurnDing(): void {
  if (!context || context.state !== "running") return;
  const now = context.currentTime;
  for (const [frequency, delay] of [[880, 0], [1320, 0.13]]) {
    const tone = context.createOscillator();
    const volume = context.createGain();
    tone.type = "sine";
    tone.frequency.value = frequency;
    volume.gain.setValueAtTime(0, now + delay);
    volume.gain.linearRampToValueAtTime(0.16, now + delay + 0.008);
    volume.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.65);
    tone.connect(volume);
    volume.connect(context.destination);
    tone.onended = () => { tone.disconnect(); volume.disconnect(); };
    tone.start(now + delay);
    tone.stop(now + delay + 0.7);
  }
}
