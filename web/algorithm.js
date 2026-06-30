/**
 * Deterministic RoB 2 judgement algorithms (individually randomized parallel-group trial,
 * effect of assignment to intervention).
 *
 * These functions implement the official decision tables from the RoB 2 guidance
 * (22 Aug 2019): Tables 3/4, 5/6, 9/10, 11/12, 13/14 and the overall-judgement table.
 *
 * The engine never lets the LLM decide domain-level or overall judgements; the LLM only
 * answers the 22 signalling questions. All aggregation happens here, deterministically.
 *
 * Pure logic — no imports, no API. 1:1 port of algorithm.py.
 */

// ---- response grouping --------------------------------------------------------
// Per the guidance, 'Yes'/'Probably yes' share implications, as do 'No'/'Probably no'.
export function group(ans) {
  // Map a raw answer to its algorithm group: YPY | NPN | NI | NA.
  if (ans === "Y" || ans === "PY") return "YPY";
  if (ans === "N" || ans === "PN") return "NPN";
  if (ans === "NI") return "NI";
  if (ans === "NA") return "NA";
  throw new Error(`Unknown answer: ${JSON.stringify(ans)}`);
}

// Build the {qid: group} map from the answers object, mirroring Python's
// {k: group(v["answer"]) for k, v in answers.items() if "answer" in v}.
function toGroups(answers) {
  const g = {};
  for (const [k, v] of Object.entries(answers)) {
    if (v && "answer" in v) g[k] = group(v.answer);
  }
  return g;
}

// ---- conditional routing ------------------------------------------------------
// Decide whether a question must be answered, given answers collected so far.
// Returns true if the question is applicable (should be sent to the LLM),
// false if it is Not Applicable (recorded as 'NA' without an LLM call).
export function isApplicable(qid, answers, effect = "assignment", design = "parallel") {
  const g = toGroups(answers);

  // Crossover-only Domain S (period & carryover) routing. Added at the top, guarded
  // by design, so the parallel/adhering paths below stay byte-for-byte unchanged.
  // S.1 and S.3 are always asked; S.2 is only asked when S.1 is N/PN/NI.
  if (design === "crossover") {
    if (qid === "S.2") return g["S.1"] === "NPN" || g["S.1"] === "NI";
    if (qid === "S.1" || qid === "S.3") return true;
    // 5.4 (crossover-only) is always asked — it falls through to `return true` below.
  }

  if (effect === "adhering") {
    // domain 2, effect of adhering to intervention (Box 7)
    const aware =
      g["2.1"] === "YPY" || g["2.1"] === "NI" ||
      g["2.2"] === "YPY" || g["2.2"] === "NI";
    if (qid === "2.3") return aware; // non-protocol balance, only if aware
    if (qid === "2.4" || qid === "2.5") return true; // assessed by default
    if (qid === "2.6") {
      return (
        g["2.3"] === "NPN" || g["2.3"] === "NI" ||
        g["2.4"] === "YPY" || g["2.4"] === "NI" ||
        g["2.5"] === "YPY" || g["2.5"] === "NI"
      );
    }
    // (no 2.7 in the adhering variant)
    return true;
  }

  // effect of assignment to intervention (Box 6) — default
  if (qid === "2.3") return g["2.1"] === "YPY" || g["2.1"] === "NI" || g["2.2"] === "YPY" || g["2.2"] === "NI";
  if (qid === "2.4") return g["2.3"] === "YPY";
  if (qid === "2.5") return g["2.4"] === "YPY" || g["2.4"] === "NI";
  if (qid === "2.7") return g["2.6"] === "NPN" || g["2.6"] === "NI";

  if (qid === "3.2") return g["3.1"] === "NPN" || g["3.1"] === "NI";
  if (qid === "3.3") return g["3.2"] === "NPN";
  if (qid === "3.4") return g["3.3"] === "YPY" || g["3.3"] === "NI";

  if (qid === "4.3") return (g["4.1"] === "NPN" || g["4.1"] === "NI") && (g["4.2"] === "NPN" || g["4.2"] === "NI");
  if (qid === "4.4") return g["4.3"] === "YPY" || g["4.3"] === "NI";
  if (qid === "4.5") return g["4.4"] === "YPY" || g["4.4"] === "NI";

  // all other questions are always asked
  return true;
}

// ---- domain algorithms --------------------------------------------------------
// a = {qid: group}.
export function judgeDomain1(a) {
  // Table 3 / Table 4 — randomization process.
  const q11 = a["1.1"], q12 = a["1.2"], q13 = a["1.3"];
  // High
  if (q12 === "NPN" || (q12 === "NI" && q13 === "YPY")) return "High";
  // Low
  if (q12 === "YPY" && (q13 === "NPN" || q13 === "NI") && (q11 === "YPY" || q11 === "NI")) return "Low";
  return "Some concerns";
}

export function judgeDomain2(a) {
  // Table 5 / Table 6 — deviations from intended interventions (assignment).
  // --- Part 1: questions 2.1-2.5 ---
  const aware = a["2.1"] === "YPY" || a["2.1"] === "NI" || a["2.2"] === "YPY" || a["2.2"] === "NI";
  let part1;
  if (!aware) {
    part1 = "Low";
  } else {
    const q23 = a["2.3"];
    if (q23 === "NPN") {
      part1 = "Low";
    } else if (q23 === "NI") {
      part1 = "Some concerns";
    } else {
      // 2.3 = YPY
      const q24 = a["2.4"];
      if (q24 === "NPN") {
        part1 = "Some concerns";
      } else {
        // 2.4 YPY/NI
        part1 = a["2.5"] === "YPY" ? "Some concerns" : "High";
      }
    }
  }

  // --- Part 2: questions 2.6-2.7 ---
  let part2;
  if (a["2.6"] === "YPY") {
    part2 = "Low";
  } else {
    // 2.6 NPN/NI
    part2 = a["2.7"] === "NPN" ? "Some concerns" : "High";
  }

  return combine(part1, part2);
}

export function judgeDomain2Adhering(a) {
  // Table 7 / Table 8 — deviations from intended interventions (effect of adhering).
  const aware = a["2.1"] === "YPY" || a["2.1"] === "NI" || a["2.2"] === "YPY" || a["2.2"] === "NI";
  let concern;
  if (!aware) {
    concern = a["2.4"] === "YPY" || a["2.4"] === "NI" || a["2.5"] === "YPY" || a["2.5"] === "NI";
  } else {
    if (a["2.3"] === "NPN" || a["2.3"] === "NI") {
      // important non-protocol ints not balanced
      concern = true;
    } else {
      // balanced (Y/PY) or not applicable
      concern = a["2.4"] === "YPY" || a["2.4"] === "NI" || a["2.5"] === "YPY" || a["2.5"] === "NI";
    }
  }
  if (!concern) return "Low";
  return a["2.6"] === "YPY" ? "Some concerns" : "High";
}

export function judgeDomain3(a) {
  // Table 9 / Table 10 — missing outcome data.
  if (a["3.1"] === "YPY") return "Low";
  if (a["3.2"] === "YPY") return "Low";
  if (a["3.3"] === "NPN") return "Low";
  if (a["3.4"] === "NPN") return "Some concerns";
  return "High"; // 3.4 in YPY/NI
}

export function judgeDomain4(a) {
  // Table 11 / Table 12 — measurement of the outcome.
  const q41 = a["4.1"], q42 = a["4.2"];
  const q45 = a["4.5"];
  // High
  if (q41 === "YPY" || q42 === "YPY" || q45 === "YPY") return "High";
  // Low
  if (
    (q41 === "NPN" || q41 === "NI") &&
    q42 === "NPN" &&
    (a["4.3"] === "NPN" || a["4.4"] === "NPN")
  ) {
    return "Low";
  }
  return "Some concerns";
}

export function judgeDomain5(a) {
  // Table 13 / Table 14 — selection of the reported result.
  if (a["5.2"] === "YPY" || a["5.3"] === "YPY") return "High";
  if (a["5.1"] === "YPY" && a["5.2"] === "NPN" && a["5.3"] === "NPN") return "Low";
  return "Some concerns";
}

// ---- crossover-specific domains (RoB 2 for crossover trials, 18 Mar 2021) ------
// Transcribed from the official algorithm flowchart figures; verified against the
// figures by hand (Domain S = Fig 2, Domain 5 = Fig 7). 1:1 port of
// algorithm_crossover.py's judge_domainS / judge_domain5.
export function judgeDomainS(a) {
  // Domain S — period & carryover effects (Figure 2). Routing starts at S.3 (carryover):
  //   S.3 = N/PN -> High;  S.3 = NI -> Some concerns;
  //   S.3 = Y/PY: S.1 = Y/PY -> Low; else S.2 = Y/PY -> Low, otherwise Some concerns.
  const s3 = a["S.3"];
  if (s3 === "NPN") return "High";
  if (s3 === "NI") return "Some concerns";
  // s3 === YPY
  if (a["S.1"] === "YPY") return "Low";
  // S.1 in NPN/NI -> S.2 decides
  if (a["S.2"] === "YPY") return "Low";
  return "Some concerns";
}

export function judgeDomain5Crossover(a) {
  // Domain 5 — selection of the reported result, crossover variant (Figure 7).
  // The 'selected-from' group is {5.2, 5.3, 5.4}:
  //   any Y/PY -> High; else any NI -> Some concerns;
  //   else (all N/PN): 5.1 = Y/PY -> Low, otherwise Some concerns.
  const sel = [a["5.2"], a["5.3"], a["5.4"]];
  if (sel.some((x) => x === "YPY")) return "High";
  if (sel.some((x) => x === "NI")) return "Some concerns";
  return a["5.1"] === "YPY" ? "Low" : "Some concerns";
}

export function combine(part1, part2) {
  if (part1 === "High" || part2 === "High") return "High";
  if (part1 === "Some concerns" || part2 === "Some concerns") return "Some concerns";
  return "Low";
}

const DOMAIN_FUNCS = {
  1: judgeDomain1,
  2: judgeDomain2,
  3: judgeDomain3,
  4: judgeDomain4,
  5: judgeDomain5,
};

export function judgeDomain(domainId, answers, effect = "assignment", design = "parallel") {
  // answers: {qid: {answer: 'PY', ...}}. Returns 'Low'|'Some concerns'|'High'.
  // domainId may be 1, 'S', 2, 3, 4, or 5 ('S' and the 5.4-aware Domain 5 only for crossover).
  const a = toGroups(answers);
  if (domainId === "S") return judgeDomainS(a);
  if (domainId === 5 && design === "crossover") return judgeDomain5Crossover(a);
  if (domainId === 2 && effect === "adhering") return judgeDomain2Adhering(a);
  return DOMAIN_FUNCS[domainId](a);
}

export function judgeOverall(domainJudgements) {
  // Table 1 — overall judgement. domainJudgements: {1:'Low', ...}.
  const vals = Object.values(domainJudgements);
  if (vals.includes("High")) return "High";
  if (vals.includes("Some concerns")) return "Some concerns";
  return "Low";
}
