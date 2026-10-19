import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKGROUND_MUSIC, BATTLE_SOUNDS, VICTORY_MUSIC, endingNation, randomTrack } from "./audio-library";
import { MusicPlayer } from "./music-player";

class FakeAudio {
  static instances: FakeAudio[] = [];
  src = "";
  volume = 1;
  preload = "";
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => {});
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn(() => { this.src = ""; });
  constructor() { FakeAudio.instances.push(this); }
}

describe("audio library", () => {
  it("includes each uploaded track and battle sound at an existing public URL", () => {
    expect(BACKGROUND_MUSIC).toHaveLength(9);
    expect(BATTLE_SOUNDS.land).toHaveLength(6);
    expect(BATTLE_SOUNDS.sea).toHaveLength(4);
    for (const url of [...BACKGROUND_MUSIC, ...BATTLE_SOUNDS.land, ...BATTLE_SOUNDS.sea]) {
      expect(existsSync(fileURLToPath(new URL(`../../public${url}`, import.meta.url))), url).toBe(true);
    }
  });
  it("uses the country reaching 25, irrespective of who wins the game", () => {
    const nations = [{ id: "ah", score: 12 }, { id: "fra", score: 25 }];
    expect(endingNation({ finished: true, nations, turn: { nationId: "fra" } })).toBe("fra");
    expect(endingNation({ finished: true, nations })).toBe("fra");
    expect(endingNation({ finished: false, nations })).toBeNull();
    expect(endingNation({ finished: true, nations: [{ id: "ah", score: 15 }] })).toBeNull();
  });
  it("can select either of a country's tracks and avoids immediate repeats", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    expect(randomTrack(VICTORY_MUSIC.ger)).toBe(VICTORY_MUSIC.ger[1]);
    expect(randomTrack(VICTORY_MUSIC.ger, VICTORY_MUSIC.ger[1])).toBe(VICTORY_MUSIC.ger[0]);
    expect(randomTrack([])).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("music playback", () => {
  beforeEach(() => { FakeAudio.instances = []; vi.stubGlobal("Audio", FakeAudio); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it("starts only on request and advances through both music folders without repeating", async () => {
    const state = vi.fn();
    const player = new MusicPlayer(state);
    const audio = FakeAudio.instances[0];
    expect(audio.play).not.toHaveBeenCalled();
    vi.spyOn(Math, "random").mockReturnValue(0);
    player.playBackground();
    await Promise.resolve();
    const first = audio.src;
    audio.onended?.();
    await Promise.resolve();
    expect(audio.src).not.toBe(first);
    expect(BACKGROUND_MUSIC).toContain(audio.src);
    expect(state).toHaveBeenLastCalledWith({ playing: true, blocked: false });
    player.stop();
    expect(state).toHaveBeenLastCalledWith({ playing: false, blocked: false });
  });
  it("replaces background music with one country-matched victory track", async () => {
    const player = new MusicPlayer(vi.fn());
    const audio = FakeAudio.instances[0];
    player.playBackground();
    player.playVictory("rus");
    await Promise.resolve();
    expect(VICTORY_MUSIC.rus).toContain(audio.src);
    expect(audio.pause).toHaveBeenCalledTimes(2);
    const played = audio.play.mock.calls.length;
    audio.onended?.();
    expect(audio.play).toHaveBeenCalledTimes(played);
  });
  it("allows a user click to retry browser-blocked victory music", async () => {
    const state = vi.fn();
    const player = new MusicPlayer(state);
    const audio = FakeAudio.instances[0];
    audio.play.mockRejectedValueOnce(new DOMException("A gesture is required", "NotAllowedError"));
    player.playVictory("uk");
    await Promise.resolve(); await Promise.resolve();
    expect(state).toHaveBeenLastCalledWith({ playing: false, blocked: true });
    const track = audio.src;
    player.resume();
    await Promise.resolve();
    expect(audio.src).toBe(track);
    expect(state).toHaveBeenLastCalledWith({ playing: true, blocked: false });
  });
  it("ignores a pending play result after stop and releases playback when leaving", async () => {
    const state = vi.fn();
    const player = new MusicPlayer(state);
    const audio = FakeAudio.instances[0];
    let resolve!: () => void;
    audio.play.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
    player.playBackground();
    player.stop();
    resolve();
    await Promise.resolve();
    expect(state).toHaveBeenLastCalledWith({ playing: false, blocked: false });
    player.dispose();
    expect(audio.onended).toBeNull();
    expect(audio.src).toBe("");
  });
});
