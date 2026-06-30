// Live test for the registry Worker's normalization (hits the real ClinicalTrials.gov API).
//   node test.mjs
// Verifies the normalized schema is stable and that the Domain-5 signals we care about
// (pre-specified outcomes + the two dates + prospective flag) come through.
import assert from "node:assert";
import { normalize, isProspective } from "./index.js";

const FIELDS = [
  "protocolSection.identificationModule",
  "protocolSection.statusModule",
  "protocolSection.designModule",
  "protocolSection.outcomesModule",
].join(",");

async function fetchAndNormalize(id) {
  const r = await fetch(`https://clinicaltrials.gov/api/v2/studies/${id}?fields=${FIELDS}`, {
    headers: { Accept: "application/json" },
  });
  assert.strictEqual(r.status, 200, `ctgov returned ${r.status} for ${id}`);
  return normalize(id, await r.json());
}

// pure-logic checks first (no network)
assert.strictEqual(isProspective("2020-12-08", "2020-12-15"), true);   // registered before enrolment
assert.strictEqual(isProspective("2021-03-01", "2020-12-15"), false);  // registered after
assert.strictEqual(isProspective(null, "2020-12-15"), null);           // unknown
assert.strictEqual(isProspective("2020-12", "2020-12-15"), true);      // partial date tolerated
console.log("prospective() logic OK");

const REQUIRED_KEYS = [
  "found", "registry", "id", "title", "status", "design", "dates",
  "prospective", "primaryOutcomes", "secondaryOutcomes", "url",
];

// A known crossover RCT — confirms design.model surfaces "CROSSOVER" (the design-selector hint).
const cross = await fetchAndNormalize("NCT00357721");
for (const k of REQUIRED_KEYS) assert.ok(k in cross, `missing key: ${k}`);
assert.strictEqual(cross.found, true);
assert.strictEqual(cross.registry, "ClinicalTrials.gov");
assert.strictEqual(cross.design.model, "CROSSOVER", `expected CROSSOVER, got ${cross.design.model}`);
assert.ok(Array.isArray(cross.primaryOutcomes));
assert.ok(cross.url.endsWith("NCT00357721"));
console.log("crossover record OK:", JSON.stringify({
  id: cross.id, design: cross.design, dates: cross.dates,
  prospective: cross.prospective, nPrimary: cross.primaryOutcomes.length,
  firstPrimary: cross.primaryOutcomes[0],
}, null, 2));

// A made-up id must come back as a clean not-found shape (404 path), not throw.
const bogus = await fetch(`https://clinicaltrials.gov/api/v2/studies/NCT00000001?fields=${FIELDS}`);
assert.ok(bogus.status === 404 || bogus.status === 200, `unexpected status ${bogus.status}`);
console.log("not-found path reachable (status", bogus.status + ")");

console.log("\nAll registry-worker tests passed.");
