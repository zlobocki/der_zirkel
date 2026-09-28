/** Fitted size relative to the size these pieces had before they were reduced. */
const FIT_SCREEN = 0.9;
/** Pieces grow with a zoom, a little more slowly than the map. */
const RELATIVE_SHRINK = 0.18;

export function mapPieceScale(zoom: number): number {
  return FIT_SCREEN * zoom ** -RELATIVE_SHRINK;
}
