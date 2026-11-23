// Solmaris Heat — entry program for the make.fun "Make GTA 6" bounty (gta6-01).
//
// What this program does, and all it does:
//   1. copies the static game (game/) and the screenshots (screenshots/) from
//      this repository into the output directory, and
//   2. writes dossier.json there with buildDossier from the vendored make.fun
//      library, using the scorer's published caps, so the dossier on disk is
//      byte for byte the one the gate rebuilds from the same files.
//
// The game itself is plain static files: open game/index.html in a desktop
// browser (or serve game/ with any static file server) and play. Nothing here
// needs the network, a build step, or anything beyond Node's standard library.
//
// Run it the way the grader does, with the output directory named by the
// environment:   MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The caps below are the scorer's own (see the kit's gate description): the
// dossier text is capped, screenshots are few and small, and game/ stays well
// inside the shared output budget.
const DOSSIER_OPTIONS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function copyTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
}

function countFiles(dir: string): number {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) total += countFiles(path);
    else total += 1;
  }
  return total;
}

function main(): void {
  const gameSource = join(repoRoot, 'game');
  const shotsSource = join(repoRoot, 'screenshots');
  if (!existsSync(join(gameSource, 'index.html'))) {
    throw new Error('game/index.html is missing: there is no game to hand in');
  }

  copyTree(gameSource, join(outputDir, 'game'));
  if (existsSync(shotsSource)) {
    copyTree(shotsSource, join(outputDir, 'screenshots'));
  } else {
    mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
  }

  const dossier = buildDossier(outputDir, DOSSIER_OPTIONS);
  writeFileSync(join(outputDir, 'dossier.json'), dossier);

  const gameFiles = countFiles(join(outputDir, 'game'));
  const shotFiles = countFiles(join(outputDir, 'screenshots'));
  console.log(
    `Solmaris Heat handed in: ${gameFiles} game files, ${shotFiles} screenshots, ` +
      `dossier of ${Buffer.byteLength(dossier)} bytes -> ${outputDir}`,
  );
}

main();
