# Learning integrations

Normal chat is **AI Ruang Belajar — Simple / Instant / Medium / High**. Provider identity is hidden unless debugging is explicitly selected. Automatic Gemini fallback is bounded to three eligible Flash candidates; no provider/account switch or paid-helper escalation is performed. The existing main provider still follows its own credit/quota policy.

## Boundaries and fallback

| Feature | Implementation | Fallback / boundary |
|---|---|---|
| Legal paper access | `/api/papers`, Unpaywall and OpenAlex | Real `UNPAYWALL_EMAIL` needed; DOI/publisher link remains usable without it. An OA link is not a blanket reuse license. |
| Citation exploration | OpenCitations, existing Cytoscape | At most 30 links per direction, partial outages disclosed; click a DOI to open the paper or resolve legal PDF. Citation count is not evidence quality. |
| PDF notes | Existing PDF.js, account-scoped Dexie | Device-local rectangular highlights; original PDF and RAG content unchanged. Native PDF link remains available. |
| Record | wavesurfer, bookmarks, Whisper segment timestamps | Long audio uses native controls; missing ASR timestamps are not invented. VAD-compacted times map back to original audio including pre-speech padding. |
| Image occlusion | Existing flashcards and FSRS | Image remains in private Storage; normalized mask is stored in the existing card. Online access is needed for the image. |
| Offline | Explicit snapshot + Serwist + Dexie | Only manually opted-in notes/cards. No API, auth token or signed private file is cached by service worker. Local review queue uses atomic idempotent RPC; conflicts are retained, not overwritten. Signing out clears local study data. |
| Data lab | DuckDB WASM, ECharts SVG, deterministic regression | CSV local, ≤5 MB; explicit units, residuals and extrapolation warning. High R² does not validate an analytical method. |
| Chemistry | RDKit WASM, PubChem, 3Dmol, RCSB | SMILES local; verified source links; `.mol` export. 2D coordinates are not mislabeled as validated 3D. Not medical/safety advice. |
| EPUB | Foliate parser, own chapter renderer, opaque sandbox and sanitization | DRM-free local EPUB ≤20 MB / 100 MB uncompressed. No scripts, external content, or automatic RAG ingestion. Device-local chapter CFI bookmark, not exact line/pagination. Foliate's nested iframe renderer is not used because it needs same-origin access incompatible with the opaque sandbox. |
| Open media | Contextual images in chat after a visual Web question | PubChem is labeled separately from FI6; Openverse attribution/rights remain visible. No standalone search form or automatic RAG ingestion. |
| Local helper | Opt-in WebLLM Qwen 0.5B in worker | WebGPU/capability guard, browser model cache, heuristic fallback; no paid remote API. Initial weights may be hundreds of MB. |
| Free helpers | `openrouter/free` or explicit `:free` | Provider max price is zero; rate-limit circuit breaker; unavailable helpers degrade to local structural checks, not paid model calls. |

## Optional document worker

These are **adapters, not hosted Python services**. Vercel/Supabase do not currently supply a long-lived CPU/GPU worker for Docling/GROBID/FlashRank. Do not enable a flag without an authenticated service implementing the contract. Existing PDF/OCR, catalog/reference integrity, and hybrid ranking remain live.

Server-only environment variables:

- `DOCUMENT_WORKER_URL`: trusted HTTPS worker origin; no URL supplied by an end user.
- `DOCUMENT_WORKER_TOKEN`: secret bearer token, never `NEXT_PUBLIC_*`.
- `ENABLE_DOCLING=true`: `POST /docling` with `{pdf: base64 PDF excerpt, pages: original page numbers}` → `{pages:[{page,text}]}`. Every requested page must appear once; weak/partial extraction falls back. Excerpt ≤8 MB, 18-second timeout. A structured alternate extraction replaces the same source/page chunks, never creates a second RAG index.
- `ENABLE_GROBID=true`: `POST /grobid` with `{pdf:base64}` → `{metadata:{title,authors,doi,year}}`. PDF ≤12 MB, 12-second timeout. Output is unverified document extraction, never overwrites manual metadata, and passes through existing catalog verification.
- `ENABLE_FLASHRANK=true`: `POST /rerank` with `{query,documents:[{id,text}]}` → `{ids:[...]}`. ≤24 candidates, 6-second timeout. Return a complete permutation; unknown/duplicate IDs rejected. Scope, original text, and leading exact evidence are retained. Choose a legally redistributable multilingual model and benchmark Indonesian queries before enabling.

The worker must implement bearer authentication, input/output limits, concurrency limits, health checks, safe PDF/XML parsing, pinned dependencies, and model-license checks. Hosting is intentionally not provisioned and no paid resource is created by this change.

Existing optional research variables remain `SEARXNG_URL`, `CRAWL4AI_URL`, `OPENROUTER_API_KEY`, `OPENROUTER_FREE_MODEL`; normal provider grounding is the fallback. Public page fetching pins DNS to validated public addresses, revalidates each of at most three redirects, forwards no credentials, limits response size, and uses a timeout. No single public SearXNG instance is required.

For authenticated Crawl4AI deployments, set server-only `CRAWL4AI_API_TOKEN` as well. Production research endpoints must be HTTPS and must not redirect authentication headers. Crawl4AI accepts legacy string Markdown and structured `raw_markdown`/`fit_markdown`; failed pages and oversized responses are rejected. Search snippets are identified as snippets, never relabeled as fetched full text. The crawler host must enforce private-address/redirect egress restrictions independently.

`Alat belajar → Audio & transkrip` imports an audio file locally (40 MB / 20 minutes maximum), transcribes Indonesian, supports cancellation and timestamps, and does not upload or ingest into RAG. The shared Record pipeline now uses native filtered resampling instead of nearest-sample decimation, verifies WebGPU adapter availability, and isolates Silero VAD in an owned worker with a timeout. VAD workers are terminated after every job; idle Whisper workers are released after 30 seconds while model weights remain cached. Cancelling never initiates a cloud fallback in the local import module. Exact silence skips Whisper. File audio does not retroactively receive WebRTC noise suppression.

`GET /api/integrations/status` reports configured versus browser versus adapter states without secret values. Run `npm test`, `npm run typecheck`, `npm run build`, then UI smoke tests before merging. Build copies public WASM/worker assets from pinned npm packages, including both ONNX WASM and JSEP variants used by the VAD runtime. Newly generated binary assets are ignored; redistribution notices are served at `/vad/LICENSES.txt`.

## General Web evidence / optional journal indexes

Web publication retrieval is topic-independent: bounded Crossref/OpenAlex/Semantic Scholar catalogs, biomedical/learning Europe PMC/PubMed, conservative bilingual topic terms, exact DOI lookup, and legal full-text candidates. Public PDF, structured publisher HTML and OA JATS XML retain section/table/page locators. Title and DOI are matched before publisher metadata overrides catalog metadata. Abstracts and search snippets never become full-text evidence. Citation identity checks are not independent semantic fact verification; answers must distinguish source findings from AI inference and disclose missing evidence. Direct user-provided public HTML URLs can be read without SearXNG. Provider grounding remains the general-search fallback when no self-hosted index is configured. No paywall/CAPTCHA bypass, private-page access, new RAG corpus, or automatic ingestion is added.

- `SCOPUS_API_KEY`: optional server-only Elsevier API key. `SCOPUS_INST_TOKEN`: optional server-only institutional token. Official STANDARD search adapter is inactive without a key, respects errors/quotas with no paid fallback, and never claims full-text access from a metadata result. Institutional/API licensing and entitlements must be arranged by the owner; no credentials/accounts/subscriptions are provisioned.
- SINTA: official journal-directory link in Paper tools; match journal title/ISSN and accreditation period yourself. No documented official public API was confirmed, so no scraping package, guessed API, automatic S1–S6 badge or fabricated Scopus-indexed claim is used.
- Normal chat has no model selector. Debug is opt-in at Settings → Plugin & AI → Diagnostik. Shared tools are available at + Upload and /tools. Audio/transcripts are at the question mic and + Upload → Rekaman & transkrip; they are not a duplicate /tools module. Offline public shell activates automatically after initial online installation; private snapshots still require opt-in.

Official references: [Scopus API](https://dev.elsevier.com/documentation/SCOPUSSearchAPI.wadl), [Elsevier access policy](https://dev.elsevier.com/sc_use_cases.html), [SINTA](https://sinta.kemdiktisaintek.go.id/), [Europe PMC REST](https://europepmc.org/RestfulWebService), [Cheerio](https://cheerio.js.org/docs/basics/loading).

## Licenses and data rights

No council implementation was copied from an external council repository. Application glue is original.

| Software / data | License / rights |
|---|---|
| PDF.js, Dexie, ECharts, WebLLM, Qwen 2.5 0.5B, FlashRank | Apache-2.0 (model weights must be checked separately for FlashRank) |
| Docling, Foliate, Serwist, DuckDB | MIT (Docling model licenses separate) |
| Cheerio 1.1.2 (inert HTML/JATS parsing) | MIT; no scripts, external XML entities or page execution |
| GROBID | Apache-2.0 |
| RDKit, 3Dmol, wavesurfer | BSD-3-Clause |
| Unpaywall metadata, OpenCitations data, PDB structures | CC0; linked papers and third-party content retain their own rights |
| PubChem | Check each contributed source's data usage terms; not blanket public domain |
| Openverse | Each image has its own CC/public-domain designation; preserve attribution and restrictions |

Authoritative upstreams: [RDKit](https://github.com/rdkit/rdkit), [DuckDB WASM](https://github.com/duckdb/duckdb-wasm), [Foliate](https://github.com/johnfactotum/foliate-js), [PDF.js](https://github.com/mozilla/pdf.js), [WebLLM](https://github.com/mlc-ai/web-llm), [Qwen](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct), [3Dmol](https://github.com/3dmol/3Dmol.js), [OpenCitations](https://opencitations.net), [Unpaywall](https://unpaywall.org/products/api), [RCSB](https://www.rcsb.org/pages/policies).
