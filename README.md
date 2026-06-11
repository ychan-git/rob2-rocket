# RoB 2 Robot

An AI tool that performs a **Cochrane RoB 2** risk-of-bias assessment for a single
randomized-trial result — one signalling question at a time — and shows the reasoning
live in the browser. It runs entirely in your browser; you bring your own Anthropic API
key. (The interface is in Traditional Chinese.)

## How it turns the Cochrane RoB 2 guidance into an AI-runnable process

RoB 2 assesses the risk of bias of **one result** (a specific outcome under one effect of
interest) across 5 domains and 22 signalling questions. This tool turns that into a
reproducible workflow:

- **The official guidance is encoded as a structured knowledge base**
  (`web/rob2_knowledge.json`): all 5 domains, the 22 signalling questions, the detailed
  guidance from the official RoB 2 document, the conditional logic for when each question
  applies, and the official judgement-algorithm tables.
- **One question at a time, independently.** Each signalling question is answered by a
  fresh, stateless model call that sees only the guidance and the trial PDF — never the
  answers to the other questions. This mirrors the RoB 2 rule that answers must be
  independent.
- **The judgements are computed, not guessed.** The model only answers the 22 questions.
  Each domain's judgement and the overall judgement are derived by running the official
  RoB 2 decision tables in code — deterministic, reproducible, and traceable to the exact
  answers. (`web/algorithm.js`; `web/algorithm.test.js` checks the logic against the
  official tables.)
- **Conditional routing.** Questions that don't apply given earlier answers are skipped
  automatically and recorded as "not applicable", exactly as the guidance specifies.

The model's role is deliberately narrow and auditable — a single-question answer with a
supporting verbatim quote and a short rationale — while the domain and overall verdicts
come from the published algorithm rather than the model's discretion.

## Running it

This is a static web app — no backend, no install. Serve the `web/` folder over http and
open it:

```bash
cd web
python3 -m http.server 7700
# then open http://localhost:7700/
```

(Module imports and the knowledge-base fetch require `http://`, so opening the file
directly with `file://` will not work. Any static server works — `npx serve`, etc.) To
deploy it as a public site, see [`web/DEPLOY.md`](web/DEPLOY.md).

You provide your own **Anthropic API key** (get one at https://console.anthropic.com). We
recommend creating a **dedicated key with a spend limit** that you can revoke at any time.

**Your key never leaves your browser.** There is no backend. The key is sent only to
Anthropic (`api.anthropic.com`) and never to us or any third party. By default it is kept
only for the current browser tab; remembering it on your device is opt-in. You can verify
this yourself in your browser's DevTools → Network tab.

## Using it

RoB 2 assesses **one result under one effect of interest**, not a whole trial. Upload an
RCT PDF, then either let the tool scan it and list candidate outcomes to choose from, or
type the outcome yourself. Choose the effect of interest — *assignment to intervention*
(intention-to-treat) or *adhering to intervention* (per-protocol); the latter switches
Domain 2 to its alternate question set. Watch each question get answered live, with a
flowchart of which questions were skipped and why, then export the full result (every
answer, supporting quote and reason) to Markdown, print/PDF, or plain text.

## Interpreting the result, and its limits

- Treat **Yes / Probably-yes** as one response and **No / Probably-no** as one, per the
  guidance.
- **Domain 5 (selection of the reported result)** is assessed from the full text only.
  Without a protocol or registry entry it will often be "No information" — this is
  expected, and reflects how most reviewers work without those documents.
- This is a decision-support tool, not a replacement for an expert reviewer.

## Attribution

This tool is built on the Cochrane **RoB 2** tool: Sterne JAC, Savović J, Page MJ, et al.
*RoB 2: a revised tool for assessing risk of bias in randomised trials.* BMJ
2019;366:l4898. The risk-of-bias framework, domains, and signalling questions are the work
of the RoB 2 development group. Please cite the original tool and consult the official
guidance at https://www.riskofbias.info/ . This is an independent tool and is not endorsed
by or affiliated with the RoB 2 development group or Cochrane.

The RoB 2 guidance text in `web/rob2_knowledge.json` (the detailed domain guidance,
signalling-question elaborations, and preliminary considerations) is **reproduced verbatim**
from the official guidance above, reformatted as JSON without modification of the text. It
remains licensed by its authors under **CC BY-NC-ND 4.0**
(https://creativecommons.org/licenses/by-nc-nd/4.0/) and is included here, with attribution,
for non-commercial use.

## License

- **Original source code** (everything except the RoB 2 guidance text) — **MIT License**, see
  [`LICENSE`](LICENSE).
- **RoB 2 guidance text** in `web/rob2_knowledge.json` — © the RoB 2 authors, **CC BY-NC-ND
  4.0** (reproduced verbatim, see Attribution above).

Because it bundles the CC BY-NC-ND content, the tool as a whole is for **non-commercial** use.

## How to cite

If you use this tool in your research, please cite it (GitHub shows a "Cite this repository"
button generated from [`CITATION.cff`](CITATION.cff)), and **also cite the original RoB 2
tool** (Sterne et al., BMJ 2019;366:l4898) under Attribution above.
