# Ruang Belajar reference engine

The user's `source_files.bibliographic_metadata` JSON is the source of truth.
No database migration is needed: provenance and audit history are additive JSON fields.

1. Existing native file/PDF extraction runs first. The existing local OCR/Gemini
   fallback remains available for scans; reference resolution itself imports no AI.
2. The local front-matter parser extracts publication candidates and DOI/PMID/ISBN.
   It stops before reference lists, validates ISBN checksums, and never treats
   an arbitrary cover year or filename as verified metadata.
3. Crossref, OpenAlex, PubMed/Europe PMC, DataCite and Open Library are independent
   public verifiers with bounded timeouts. Exact identifiers are checked.
   Fuzzy matches need strong title and independent evidence; editions must agree.
   Open Library ISBN retrieval uses edition records, not aggregated work search.
4. Manual corrections remain locked. Catalog disagreements, missing values and
   the verification basis are saved in `metadata.audit`; prior audit summaries
   are retained (bounded to nine previous runs).
5. CSL conversion and citation formatting run locally. APA 7, Vancouver, MLA 9,
   Leeds Harvard, IEEE and Chicago 18 author-date styles are supported.
   Unreviewed/automatic/conflicting and legacy metadata without the current
   engine's audit are excluded from formal citation output.

## Endpoints and UI

- The file's **Metadata referensi** panel offers local/catalog rescan, full-library
  audit (including old verified records), manual correction and six style previews.
  Uploads already invoke metadata resolution after RAW extraction.
- `POST /api/citations`: own-Library session required; body
  `{sourceFileIds: [...], style: "apa"}`. It loads only owned files, ignores
  client-supplied metadata, returns CSL, in-text mappings, bibliography and
  excluded file IDs. Numeric input order is first-citation order.
- `GET /api/integrations/status`: capabilities and deployed commit.
- `GET /api/integrations/status?verify=1`: cached, fixed public DOI/PMID/ISBN
  smoke records and all six local CSL styles. No user library or credential data.
- `/api/mendeley/connect` returns 410 by default. Existing OAuth code is isolated
  for compatibility behind `ENABLE_LEGACY_MENDELEY=true`; it is never used by
  the new reference resolver, audit, preview or citation-generation path.

Run `npm ci`, `npm test`, `npm run typecheck`, `npm run build`.
Tests use the existing TypeScript compiler; no AI key or Mendeley secret is required.
