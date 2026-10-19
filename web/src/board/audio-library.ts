export type BattleKind = "land" | "sea";
export const BATTLE_SOUNDS: Record<BattleKind, string[]> = {
  land: Array.from({ length: 6 }, (_, index) => `/audio/battles/land_battle_sound_${index + 1}.mp3`),
  sea: Array.from({ length: 4 }, (_, index) => `/audio/battles/sea_battle_sound_${index + 1}.mp3`),
};
export const VICTORY_MUSIC: Record<string, string[]> = {
  ah: ["/audio/music/Austria_Hungary_Radetzky_March.ogg"],
  uk: ["/audio/music/Britain_It's_A_Long_Way_To_Tipperary.opus", "/audio/music/Britain_Rule_Britannia.ogg"],
  fra: ["/audio/music/France_La_Marseillaise.mp3"],
  ger: ["/audio/music/Germany_Erika.ogg", "/audio/music2/Germany_Ride_of_the_Valkyries.ogg"],
  ita: ["/audio/music2/Italy_Bella_Ciao.mp3"],
  rus: ["/audio/music2/Russia_Farewell_of_Slavianka.mp3", "/audio/music2/Russia_Soviet_Anthem.ogg"],
};
export const BACKGROUND_MUSIC = Object.values(VICTORY_MUSIC).flat();
export function randomTrack(tracks: string[], previous?: string): string | null {
  const choices = tracks.length > 1 ? tracks.filter((track) => track !== previous) : tracks;
  return choices.length ? choices[Math.floor(Math.random() * choices.length)] : null;
}
export function endingNation(board: { finished: boolean; nations: Array<{ id: string; score: number }>; turn?: { nationId: string } | null }): string | null {
  if (!board.finished) return null;
  return board.nations.find((nation) => nation.id === board.turn?.nationId && nation.score >= 25)?.id
    ?? board.nations.find((nation) => nation.score >= 25)?.id ?? null;
}
