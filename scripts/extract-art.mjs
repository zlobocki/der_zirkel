// Refreshes web/public/art and web/src/board/slots.json from Assets.zip.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.join(root, "web/public/art");
mkdirSync(destination, { recursive: true });

const publicFiles = [
  "Assets/background.png",
  "Assets/game_board.svg",
  "Assets/factory_land.png",
  "Assets/factory_sea.png",
  "Assets/investor.png",
  "Assets/swiss_bank.png",
  "Assets/turn_marker.png",
];
const source = path.join(root, "web/public/art-src");

execFileSync(
  "unzip",
  ["-o", "-q", path.join(root, "Assets.zip"), ...publicFiles, "Assets/game_board_overlay.svg", "-d", source],
  { stdio: "inherit" },
);
for (const file of publicFiles) {
  execFileSync("cp", [path.join(source, file), path.join(destination, path.basename(file))]);
}
execFileSync("python3", [path.join(root, "scripts/extract_slots.py")], { stdio: "inherit" });
