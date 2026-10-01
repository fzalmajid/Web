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
| Open media | Openverse in Web source panel only | Not automatic RAG material. Per-image source, creator and license displayed; outages do not interrupt normal Web research. |
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

Existing optional research variables remain `SEARXNG_URL`, `CRAWL4AI_URL`, `OPENROUTER_API_KEY`, `OPENROUTER_FREE_MODEL`; normal provider grounding is the fallback. Public page fetching pins DNS to validated public addresses, forbids redirects, limits response size, and uses a timeout. No single public SearXNG instance is required.

`GET /api/integrations/status` reports configured versus browser versus adapter states without secret values. Run `npm test`, `npm run typecheck`, `npm run build`, then UI smoke tests before merging. Build copies public WASM/worker assets from pinned npm packages; generated assets are not committed.

## Licenses and data rights

No council implementation was copied from an external council repository. Application glue is original.

| Software / data | License / rights |
|---|---|
| PDF.js, Dexie, ECharts, WebLLM, Qwen 2.5 0.5B, FlashRank | Apache-2.0 (model weights must be checked separately for FlashRank) |
| Docling, Foliate, Serwist, DuckDB | MIT (Docling model licenses separate) |
| GROBID | Apache-2.0 |
| RDKit, 3Dmol, wavesurfer | BSD-3-Clause |
| Unpaywall metadata, OpenCitations data, PDB structures | CC0; linked papers and third-party content retain their own rights |
| PubChem | Check each contributed source's data usage terms; not blanket public domain |
| Openverse | Each image has its own CC/public-domain designation; preserve attribution and restrictions |

Authoritative upstreams: [RDKit](https://github.com/rdkit/rdkit), [DuckDB WASM](https://github.com/duckdb/duckdb-wasm), [Foliate](https://github.com/johnfactotum/foliate-js), [PDF.js](https://github.com/mozilla/pdf.js), [WebLLM](https://github.com/mlc-ai/web-llm), [Qwen](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct), [3Dmol](https://github.com/3dmol/3Dmol.js), [OpenCitations](https://opencitations.net), [Unpaywall](https://unpaywall.org/products/api), [RCSB](https://www.rcsb.org/pages/policies).
