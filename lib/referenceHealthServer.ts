import { citationPreviews } from "./citationFormatterServer";
import { auditReferenceMetadata, resolveReferenceMetadata } from "./referencePipelineServer";
import type { ReferenceMetadata } from "./referenceMetadata";

let cached: { expires: number; value: unknown } | null = null;
let pending: Promise<unknown> | null = null;

/** Fixed public test records only: no user files, credentials or tokens. */
export async function verifyReferenceEngine() {
  if (cached && cached.expires > Date.now()) return cached.value;
  if (pending) return pending;
  pending = (async () => {
    const local: ReferenceMetadata = {
      title: "Reference engine verification", authors: ["Test Author"], year: 2026, type: "book",
    };
    local.audit = auditReferenceMetadata(local, { manual: true });
    const previews = citationPreviews(local);
    const styles = Object.fromEntries(Object.entries(previews).map(([style, text]) => [style, Boolean(text)]));
    const samples = [
      { identifier: "doi", fileName: "article.pdf", frontMatter: "DOI: 10.1038/171737a0" },
      { identifier: "pmid", fileName: "article.pdf", frontMatter: "PMID: 13054692" },
      { identifier: "isbn", fileName: "book.pdf", frontMatter: "ISBN: 9780131103627" },
    ];
    const resolved = await Promise.allSettled(samples.map(async (sample) => {
      const result = await resolveReferenceMetadata(sample);
      return {
        identifier: sample.identifier, status: result.status,
        title: result.metadata.title, year: result.metadata.year,
        catalogs: result.catalogMatches.map((match) => match.source),
        citationReady: Boolean(citationPreviews(result.metadata).apa),
        issues: result.metadata.audit?.issues || [],
      };
    }));
    const value = {
      checkedAt: new Date().toISOString(), localCsl: styles,
      publicMetadata: resolved.map((result, index) => result.status === "fulfilled" ? result.value :
        { identifier: samples[index].identifier, status: "unavailable" }),
    };
    cached = { expires: Date.now() + 5 * 60 * 1000, value };
    return value;
  })();
  try { return await pending; } finally { pending = null; }
}
