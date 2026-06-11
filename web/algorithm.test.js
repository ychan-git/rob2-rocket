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

console.log("All self-tests passed (assignment + adhering).");
