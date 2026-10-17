import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Seeds the D1 database with a set of demo riders.
 *
 * Usage:
 *   bun run scripts/seed.ts            # local D1 (wrangler dev state)
 *   bun run scripts/seed.ts --remote   # remote D1
 *
 * Safe to run more than once: existing permanent numbers are left untouched.
 */

interface SeedRider {
  permanentNumber: number;
  firstName: string;
  lastName: string;
  countryIso: string;
}

const RIDERS: SeedRider[] = [
  { permanentNumber: 757, firstName: "Juan", lastName: "Pérez", countryIso: "AR" },
  { permanentNumber: 101, firstName: "Bartosz", lastName: "Kowalski", countryIso: "PL" },
  { permanentNumber: 44, firstName: "Danny", lastName: "King", countryIso: "GB" },
  { permanentNumber: 69, firstName: "Martin", lastName: "Smolinski", countryIso: "DE" },
  { permanentNumber: 223, firstName: "Nicolás", lastName: "Covatti", countryIso: "AR" },
  { permanentNumber: 85, firstName: "Anton", lastName: "Karlsson", countryIso: "SE" },
  { permanentNumber: 108, firstName: "Kacper", lastName: "Woryna", countryIso: "PL" },
  { permanentNumber: 5, firstName: "Jack", lastName: "Holder", countryIso: "AU" },
  { permanentNumber: 136, firstName: "Grzegorz", lastName: "Zengota", countryIso: "PL" },
  { permanentNumber: 71, firstName: "Maciej", lastName: "Janowski", countryIso: "PL" },
  { permanentNumber: 92, firstName: "Freddie", lastName: "Lindgren", countryIso: "SE" },
  { permanentNumber: 95, firstName: "Bartosz", lastName: "Zmarzlik", countryIso: "PL" },
  { permanentNumber: 155, firstName: "Robert", lastName: "Lambert", countryIso: "GB" },
  { permanentNumber: 225, firstName: "Emil", lastName: "Sayfutdinov", countryIso: "RU" },
  { permanentNumber: 30, firstName: "Leon", lastName: "Madsen", countryIso: "DK" },
  { permanentNumber: 505, firstName: "Mateusz", lastName: "Cierniak", countryIso: "PL" },
  { permanentNumber: 999, firstName: "Rafał", lastName: "Karczmarz", countryIso: "PL" },
  { permanentNumber: 16, firstName: "Santiago", lastName: "Alvarez", countryIso: "AR" },
];

function escape(value: string): string {
  return value.replace(/'/g, "''");
}

function buildSql(): string {
  const values = RIDERS.map(
    (rider) =>
      `(${rider.permanentNumber}, '${escape(rider.firstName)}', '${escape(
        rider.lastName,
      )}', '${rider.countryIso}')`,
  ).join(",\n  ");
  return [
    "-- Datos de ejemplo (idempotente).",
    "INSERT OR IGNORE INTO riders (permanent_number, first_name, last_name, country_iso)",
    `VALUES\n  ${values};`,
    "",
  ].join("\n");
}

const remote = process.argv.includes("--remote");
const directory = mkdtempSync(join(tmpdir(), "speedway-seed-"));
const file = join(directory, "seed.sql");
writeFileSync(file, buildSql(), "utf8");

const args = [
  "bun",
  "x",
  "wrangler",
  "d1",
  "execute",
  "speedway",
  remote ? "--remote" : "--local",
  `--file=${file}`,
  "--yes",
];

console.log(`Sembrando ${RIDERS.length} pilotos en D1 (${remote ? "remoto" : "local"})...`);
const process_ = Bun.spawn(args, { stdout: "inherit", stderr: "inherit" });
const exitCode = await process_.exited;
if (exitCode !== 0) {
  console.error("El seed falló. Verificá que wrangler esté disponible y la base exista.");
  process.exit(exitCode);
}
console.log("Seed completado.");
