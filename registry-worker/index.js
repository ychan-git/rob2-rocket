/**
 * RoB2 Rocket — trial-registry lookup Worker (Phase 1: ClinicalTrials.gov / NCT).
 *
 * Why a Worker: ClinicalTrials.gov's API v2 sends no CORS header, so the pure-frontend
 * rob2-rocket app cannot fetch it from the browser. This Worker fetches it server-side,
 * normalizes the registry payload into ONE stable schema, and adds CORS so the app (and a
 * future MCP wrapper) can consume it. It only ever receives a public NCT id — never the
 * PDF, never any patient data.
 *
 * Endpoint:  GET /registry?id=NCT01234567
 * Response:  application/json (see README.md → NORMALIZED SCHEMA). Always JSON, even on
 *            "not found" ({found:false}) so the caller can degrade Domain 5 to NI cleanly.
 *
 * Phase 2 (schema already shaped for it): ITMCTR / ChiCTR / UMIN / KCT, ctgov version
 * history (outcome-switching), and an MCP server wrapping this same core.
 */

// Only the modules we actually read — keeps the upstream payload small.
const CTGOV_FIELDS = [
  "protocolSection.identificationModule",
  "protocolSection.statusModule",
  "protocolSection.designModule",
  "protocolSection.outcomesModule",
].join(",");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra },
  });

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);

    const url = new URL(request.url);
    if (url.pathname !== "/registry" && url.pathname !== "/") {
      return json({ error: "not_found", hint: "GET /registry?id=NCT01234567" }, 404);
    }

    const id = (url.searchParams.get("id") || "").trim().toUpperCase();
    if (!/^NCT\d{8}$/.test(id)) {
      return json(
        { found: false, error: "invalid_id",
          hint: "Phase 1 supports ClinicalTrials.gov ids only: 'NCT' followed by 8 digits." },
        400,
      );
    }

    // Edge cache — registry records change slowly; be polite to ctgov.
    const cacheKey = new Request("https://rob2-registry.internal/cache/" + id);
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    let upstream;
    try {
      upstream = await fetch(
        `https://clinicaltrials.gov/api/v2/studies/${id}?fields=${CTGOV_FIELDS}`,
        { headers: { Accept: "application/json" } },
      );
    } catch (e) {
      return json({ found: false, error: "upstream_unreachable" }, 502);
    }
    // ctgov returns 404 for an unknown / withdrawn NCT — surface as a clean "not found".
    if (upstream.status === 404) {
      return json({ found: false, id, registry: "ClinicalTrials.gov" }, 200);
    }
    if (!upstream.ok) {
      return json({ found: false, error: "upstream_error", status: upstream.status }, 502);
    }

    let data;
    try {
      data = await upstream.json();
    } catch (e) {
      return json({ found: false, error: "bad_upstream_json" }, 502);
    }

    const record = normalize(id, data);
    const response = json(record, 200, { "Cache-Control": "public, max-age=86400" });
    // Store a clone at the edge for 24h (waitUntil so we don't delay the response).
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};

// ---- normalization ----------------------------------------------------------
// Map ctgov v2's nested protocolSection into the stable schema the app/MCP consume.
// (Also named-exported so test.mjs can verify the mapping against the live API.)
export function normalize(id, data) {
  const ps = data.protocolSection || {};
  const idm = ps.identificationModule || {};
  const st = ps.statusModule || {};
  const des = (ps.designModule || {}).designInfo || {};
  const om = ps.outcomesModule || {};

  const firstSubmitted = st.studyFirstSubmitDate || null;            // "YYYY-MM-DD"
  const firstPosted = (st.studyFirstPostDateStruct || {}).date || null;
  const enrollmentStart = (st.startDateStruct || {}).date || null;
  // "Registered before enrolment?" — use the earliest registry footprint we have.
  const registeredDate = firstSubmitted || firstPosted;

  const mapOutcomes = (arr) =>
    (arr || []).map((o) => ({ measure: o.measure || "", timeFrame: o.timeFrame || "" }));

  return {
    found: true,
    registry: "ClinicalTrials.gov",
    id,
    title: idm.briefTitle || idm.officialTitle || "",
    status: st.overallStatus || "",
    design: { allocation: des.allocation || null, model: des.interventionModel || null },
    dates: { firstSubmitted, firstPosted, enrollmentStart },
    prospective: isProspective(registeredDate, enrollmentStart),
    primaryOutcomes: mapOutcomes(om.primaryOutcomes),
    secondaryOutcomes: mapOutcomes(om.secondaryOutcomes),
    url: `https://clinicaltrials.gov/study/${id}`,
  };
}

// true  = registered on/before enrolment start (prospective)
// false = registered after (retrospective)
// null  = can't tell (a date is missing) — caller should fall back to the raw dates
export function isProspective(registeredDate, enrollmentStart) {
  const a = lowerBound(registeredDate);
  const b = lowerBound(enrollmentStart);
  if (a == null || b == null) return null;
  return a <= b;
}

// Parse a possibly-partial ctgov date ("YYYY", "YYYY-MM", "YYYY-MM-DD") to a comparable
// epoch (start of the stated period). Partial dates are coarse by nature; the raw strings
// stay in `dates` so a borderline prospective flag is always auditable.
function lowerBound(s) {
  if (!s) return null;
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(s);
  if (!m) return null;
  const year = +m[1];
  const month = m[2] ? +m[2] - 1 : 0;
  const day = m[3] ? +m[3] : 1;
  return Date.UTC(year, month, day);
}
