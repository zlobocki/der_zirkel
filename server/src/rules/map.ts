import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NATION_NAME, type NationId } from "./constants.js";

export type RegionKind = "land" | "sea";

export type Region = {
  id: string;
  name: string;
  kind: RegionKind;
  home: NationId | null;
  links: string[];
  port: string | null;
};

const HOME_BY_NAME = new Map<string, NationId>(
  (Object.entries(NATION_NAME) as Array<[NationId, string]>).map(([id, name]) => [name, id]),
);

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (character !== "\r") {
      cell += character;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function loadRegions(): Map<string, Region> {
  const csvPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../regions.csv");
  const rows = parseCsv(readFileSync(csvPath, "utf8")).slice(1);
  const regions = new Map<string, Region>();
  for (const [id, name, status, links] of rows) {
    if (!id || !name) {
      continue;
    }
    const neighbors = (links ?? "")
      .split(",")
      .map((part) => part.trim().match(/^(?:LR|SR)\d+/)?.[0])
      .filter((part): part is string => Boolean(part));
    const port = links?.match(/port is connected (?:to|with) (SR\d+)/i)?.[1] ?? null;
    regions.set(id, {
      id,
      name,
      kind: id.startsWith("SR") ? "sea" : "land",
      home: HOME_BY_NAME.get(status ?? "") ?? null,
      links: port && !neighbors.includes(port) ? [...neighbors, port] : neighbors,
      port,
    });
  }
  for (const region of regions.values()) {
    for (const link of region.links) {
      const other = regions.get(link);
      if (other && !other.links.includes(region.id)) {
        other.links.push(region.id);
      }
    }
  }
  return regions;
}

export const regions = loadRegions();

export function linked(from: string, to: string): boolean {
  return regions.get(from)?.links.includes(to) ?? false;
}
