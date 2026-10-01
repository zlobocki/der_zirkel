import { describe, expect, it } from "vitest";
import { firstEmptySlot } from "../../../web/src/board/occupy.ts";

describe("firstEmptySlot", () => {
  const points: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [0, 10],
  ];

  it("prefers a printed slot with no unit or flag", () => {
    expect(firstEmptySlot(points, [])).toEqual([0, 0]);
    expect(firstEmptySlot(points, ["stack:uk:army"])).toEqual([10, 0]);
    expect(firstEmptySlot(points, ["stack:uk:army", "flag:LR8"])).toEqual([0, 10]);
  });

  it("returns null once every printed slot is taken", () => {
    expect(firstEmptySlot(points, ["a", "b", "c"])).toBeNull();
  });
});
