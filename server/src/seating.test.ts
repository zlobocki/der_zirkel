import { describe, expect, it } from "vitest";
import { shuffleSeats } from "./seating.js";

describe("random player order", () => {
  const seats = [{ seat: 0, name: "Creator", kind: "human" }, { seat: 1, name: "Guest", kind: "human" }, { seat: 2, name: "AI", kind: "ai" }];
  it("can move the creator out of first place and interleave AI seats", () => {
    const order = shuffleSeats(seats, () => 0);
    expect(order.map((seat) => seat.name)).toEqual(["Guest", "AI", "Creator"]);
    expect(order.map((seat) => seat.seat)).toEqual([0, 1, 2]);
    expect(seats[0]).toEqual({ seat: 0, name: "Creator", kind: "human" });
  });
  it("permits every permutation without losing or duplicating players", () => {
    const orders = new Set<string>();
    for (let first = 0; first < 3; first += 1) for (let second = 0; second < 2; second += 1) {
      const picks = [first, second];
      const result = shuffleSeats(seats, (limit) => { const picked = picks.shift()!; expect(picked).toBeLessThan(limit); return picked; });
      orders.add(result.map((seat) => seat.name).join(","));
      expect(new Set(result.map((seat) => seat.name)).size).toBe(3);
    }
    expect(orders.size).toBe(6);
  });
});
