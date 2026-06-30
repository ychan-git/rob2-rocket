// Offline self-test — ported 1:1 from the `if __name__ == "__main__":` block of algorithm.py.
import assert from "node:assert";
import { judgeDomain, judgeOverall, isApplicable } from "./algorithm.js";

function mk(kw) {
  // mirror Python's mk(**kw): {qid: {"answer": value}}
  const out = {};
  for (const [k, v] of Object.entries(kw)) out[k] = { answer: v };
  return out;
}

// sample trial (matches the UI demo)
const demo = mk({
  "1.1": "PY", "1.2": "PY", "1.3": "PN",
  "2.1": "Y", "2.2": "Y", "2.3": "PN", "2.4": "NA", "2.5": "NA",
  "2.6": "PY", "2.7": "NA",
  "3.1": "PY", "3.2": "NA", "3.3": "NA", "3.4": "NA",
  "4.1": "PN", "4.2": "PN", "4.3": "N", "4.4": "NA", "4.5": "NA",
  "5.1": "NI", "5.2": "NI", "5.3": "NI",
});
const dj = {};
for (let d = 1; d <= 5; d++) dj[d] = judgeDomain(d, demo);
console.log("Domain judgements:", dj);
console.log("Overall:", judgeOverall(dj));
assert.deepStrictEqual(
  dj,
  { 1: "Low", 2: "Low", 3: "Low", 4: "Low", 5: "Some concerns" },
  JSON.stringify(dj)
);
assert.strictEqual(judgeOverall(dj), "Some concerns");

// edge cases
const high_d1 = { 1: judgeDomain(1, mk({ "1.1": "Y", "1.2": "N", "1.3": "N" })) };
assert.strictEqual(high_d1[1], "High", JSON.stringify(high_d1));
// not random but concealed, no imbalance -> Some concerns
const some_d1 = judgeDomain(1, mk({ "1.1": "N", "1.2": "Y", "1.3": "N" }));
assert.strictEqual(some_d1, "Some concerns", some_d1);
// domain 2 high via unbalanced affecting deviations
const d2h = judgeDomain(2, mk({
  "2.1": "Y", "2.2": "Y", "2.3": "Y", "2.4": "Y",
  "2.5": "N", "2.6": "Y", "2.7": "NA",
}));
assert.strictEqual(d2h, "High", d2h);
// domain 4 high via likely influenced
const d4h = judgeDomain(4, mk({ "4.1": "N", "4.2": "N", "4.3": "Y", "4.4": "Y", "4.5": "Y" }));
assert.strictEqual(d4h, "High", d4h);

// --- adhering (per-protocol) variant ---
// blinded, no failure, adhered -> Low
const adh_low = judgeDomain(2, mk({
  "2.1": "N", "2.2": "N", "2.3": "NA", "2.4": "N", "2.5": "N", "2.6": "NA",
}), "adhering");
assert.strictEqual(adh_low, "Low", adh_low);
// non-adherence present + appropriate analysis -> Some concerns
const adh_some = judgeDomain(2, mk({
  "2.1": "N", "2.2": "N", "2.3": "NA", "2.4": "N", "2.5": "Y", "2.6": "Y",
}), "adhering");
assert.strictEqual(adh_some, "Some concerns", adh_some);
// non-adherence present + inappropriate analysis -> High
const adh_high = judgeDomain(2, mk({
  "2.1": "N", "2.2": "N", "2.3": "NA", "2.4": "N", "2.5": "Y", "2.6": "N",
}), "adhering");
assert.strictEqual(adh_high, "High", adh_high);
// aware + non-protocol not balanced + inappropriate analysis -> High
const adh_h2 = judgeDomain(2, mk({
  "2.1": "Y", "2.2": "Y", "2.3": "N", "2.4": "N", "2.5": "N", "2.6": "NI",
}), "adhering");
assert.strictEqual(adh_h2, "High", adh_h2);
// adhering routing: 2.6 skipped when no concern
assert.ok(
  !isApplicable("2.6", mk({ "2.1": "N", "2.2": "N", "2.4": "N", "2.5": "N" }), "adhering")
);
assert.ok(
  isApplicable("2.6", mk({ "2.1": "N", "2.2": "N", "2.4": "N", "2.5": "Y" }), "adhering")
);

// --- adhering effect must still apply domain 3/4 conditional routing ---------
// (Regression guard: a prior `return true` in the adhering branch skipped this routing,
// always-asking 3.2-3.4 / 4.3-4.5 under PP. Domains 3/4/5 routing is effect-independent —
// the effect only changes Domain 2 — so PP must route them exactly like ITT.)
// Domain 3: 3.2 is NA when 3.1 = Y/PY (data near-complete), under either effect.
assert.ok(!isApplicable("3.2", mk({ "3.1": "Y" }), "adhering"), "PP: 3.2 should be NA when 3.1=Y");
assert.ok(isApplicable("3.2", mk({ "3.1": "N" }), "adhering"), "PP: 3.2 asked when 3.1=N");
assert.ok(!isApplicable("3.3", mk({ "3.1": "N", "3.2": "Y" }), "adhering"), "PP: 3.3 NA when 3.2=Y");
// Domain 4: 4.3 needs BOTH 4.1 and 4.2 in N/PN/NI; 4.5 needs 4.4 in Y/PY/NI.
assert.ok(!isApplicable("4.3", mk({ "4.1": "Y", "4.2": "Y" }), "adhering"), "PP: 4.3 NA when 4.1/4.2=Y");
assert.ok(!isApplicable("4.5", mk({ "4.1": "N", "4.2": "N", "4.3": "Y", "4.4": "N" }), "adhering"),
  "PP: 4.5 NA when 4.4=N (the verdict-flip path that prompted the fix)");
assert.ok(isApplicable("4.5", mk({ "4.1": "N", "4.2": "N", "4.3": "Y", "4.4": "Y" }), "adhering"),
  "PP: 4.5 asked when 4.4=Y");
// The flip path now resolves to Low under PP (4.5 stays NA, not a stray High).
const ppD4 = judgeDomain(4, mk({ "4.1": "N", "4.2": "N", "4.3": "Y", "4.4": "N", "4.5": "NA" }), "adhering");
assert.strictEqual(ppD4, "Low", ppD4);
// Sanity: the same routing assertions hold for the assignment effect (unchanged behaviour).
assert.ok(!isApplicable("3.2", mk({ "3.1": "Y" }), "assignment"));
assert.ok(!isApplicable("4.5", mk({ "4.1": "N", "4.2": "N", "4.3": "Y", "4.4": "N" }), "assignment"));

console.log("All self-tests passed (assignment + adhering).");

// --- crossover variant (ported 1:1 from algorithm_crossover.py self-tests) ---
const X = "crossover";
// Domain S (period & carryover) — exhaustive over the flowchart paths (Figure 2)
// S.3 = N/PN -> High (regardless of S.1/S.2)
assert.strictEqual(judgeDomain("S", mk({ "S.1": "Y", "S.2": "NA", "S.3": "N" }), "assignment", X), "High");
assert.strictEqual(judgeDomain("S", mk({ "S.1": "N", "S.2": "N", "S.3": "PN" }), "assignment", X), "High");
// S.3 = NI -> Some concerns
assert.strictEqual(judgeDomain("S", mk({ "S.1": "Y", "S.2": "NA", "S.3": "NI" }), "assignment", X), "Some concerns");
// S.3 = Y/PY, S.1 = Y/PY -> Low (S.2 not applicable)
assert.strictEqual(judgeDomain("S", mk({ "S.1": "Y", "S.2": "NA", "S.3": "Y" }), "assignment", X), "Low");
assert.strictEqual(judgeDomain("S", mk({ "S.1": "PY", "S.2": "NA", "S.3": "PY" }), "assignment", X), "Low");
// S.3 = Y/PY, S.1 = N/PN/NI, S.2 = Y/PY -> Low
assert.strictEqual(judgeDomain("S", mk({ "S.1": "N", "S.2": "Y", "S.3": "Y" }), "assignment", X), "Low");
assert.strictEqual(judgeDomain("S", mk({ "S.1": "NI", "S.2": "PY", "S.3": "Y" }), "assignment", X), "Low");
// S.3 = Y/PY, S.1 = N/PN/NI, S.2 = N/PN/NI -> Some concerns
assert.strictEqual(judgeDomain("S", mk({ "S.1": "N", "S.2": "N", "S.3": "Y" }), "assignment", X), "Some concerns");
assert.strictEqual(judgeDomain("S", mk({ "S.1": "PN", "S.2": "NI", "S.3": "PY" }), "assignment", X), "Some concerns");

// Domain S routing: S.2 only applicable when S.1 in N/PN/NI
assert.ok(!isApplicable("S.2", mk({ "S.1": "Y", "S.3": "Y" }), "assignment", X));
assert.ok(isApplicable("S.2", mk({ "S.1": "N", "S.3": "Y" }), "assignment", X));
assert.ok(isApplicable("S.2", mk({ "S.1": "NI", "S.3": "Y" }), "assignment", X));

// Domain 5 (crossover, with 5.4) — Figure 7
// all selection-group N/PN + pre-specified plan -> Low
assert.strictEqual(judgeDomain(5, mk({ "5.1": "Y", "5.2": "N", "5.3": "N", "5.4": "N" }), "assignment", X), "Low");
// all selection-group N/PN but no pre-specified plan (5.1 NI) -> Some concerns
assert.strictEqual(judgeDomain(5, mk({ "5.1": "NI", "5.2": "N", "5.3": "N", "5.4": "N" }), "assignment", X), "Some concerns");
// 5.4 = Y (carryover-driven first-period-only selection) -> High
assert.strictEqual(judgeDomain(5, mk({ "5.1": "Y", "5.2": "N", "5.3": "N", "5.4": "Y" }), "assignment", X), "High");
// one NI in selection group, none Y/PY -> Some concerns
assert.strictEqual(judgeDomain(5, mk({ "5.1": "Y", "5.2": "N", "5.3": "NI", "5.4": "N" }), "assignment", X), "Some concerns");
// 5.2 = PY -> High
assert.strictEqual(judgeDomain(5, mk({ "5.1": "Y", "5.2": "PY", "5.3": "N", "5.4": "N" }), "assignment", X), "High");

// shared domains behave exactly like parallel under crossover
assert.strictEqual(judgeDomain(1, mk({ "1.1": "Y", "1.2": "Y", "1.3": "N" }), "assignment", X), "Low");
assert.strictEqual(judgeDomain(1, mk({ "1.1": "Y", "1.2": "N", "1.3": "N" }), "assignment", X), "High");

// a full crossover assessment (matches algorithm_crossover.py's final test)
const xfull = mk({
  "1.1": "Y", "1.2": "PY", "1.3": "N",
  "S.1": "Y", "S.2": "NA", "S.3": "Y",
  "2.1": "N", "2.2": "N", "2.3": "NA", "2.4": "NA", "2.5": "NA", "2.6": "N", "2.7": "Y",
  "3.1": "PN", "3.2": "N", "3.3": "PN", "3.4": "NA",
  "4.1": "N", "4.2": "PN", "4.3": "N", "4.4": "NA", "4.5": "NA",
  "5.1": "NI", "5.2": "PN", "5.3": "PN", "5.4": "N",
});
const xorder = [1, "S", 2, 3, 4, 5];
const xdj = {};
for (const d of xorder) xdj[d] = judgeDomain(d, xfull, "assignment", X);
assert.deepStrictEqual(
  xdj,
  { 1: "Low", S: "Low", 2: "High", 3: "Low", 4: "Low", 5: "Some concerns" },
  JSON.stringify(xdj)
);
assert.strictEqual(judgeOverall(xdj), "High");

// crossover + adhering (PP): domain 3/4 routing must apply too (the previously-uncovered combo)
assert.ok(!isApplicable("3.2", mk({ "3.1": "Y" }), "adhering", X), "crossover+PP: 3.2 NA when 3.1=Y");
assert.ok(!isApplicable("4.5", mk({ "4.1": "N", "4.2": "N", "4.3": "Y", "4.4": "N" }), "adhering", X),
  "crossover+PP: 4.5 NA when 4.4=N");
// crossover Domain S routing is unaffected by the adhering effect
assert.ok(!isApplicable("S.2", mk({ "S.1": "Y", "S.3": "Y" }), "adhering", X));

console.log("All crossover self-tests passed (Domain S, 5.4, shared domains, overall).");
