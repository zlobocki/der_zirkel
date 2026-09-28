/** Screen size of a map piece, as a fraction of its size before this adjustment. */
const FIT_SCREEN = 0.75;
/** Pieces may shrink a little while zooming, then they stop at this screen size. */
const MIN_SCREEN = 0.5;
const SHRINK = 0.35;

export function mapPieceScale(zoom: number): number {
  const screen = Math.max(MIN_SCREEN, FIT_SCREEN * zoom ** -SHRINK);
  return screen / zoom;
}
