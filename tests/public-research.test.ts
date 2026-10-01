import { strict as assert } from "node:assert";
import { test } from "node:test";
import { doiFromUrl, publicUrl, mapOaLocation, mapCitationEdges } from "../lib/publicResearch";
test("DOI and URLs are validated without unsafe links", () => {
  assert.equal(doiFromUrl("https://doi.org/10.1000/example"), "10.1000/example");
  assert.equal(publicUrl("javascript:alert(1)"), null);
  assert.equal(publicUrl("https://localhost/private"), null);
  assert.equal(mapOaLocation({ url_for_pdf: "https://example.org/legal.pdf", license: "cc-by" }).license, "cc-by");
});
test("citation identifiers are deduplicated and direction is preserved", () => {
  const rows = [{ cited: "omid:br/1 doi:10.1000/a pmid:22" }, { cited: "doi:10.1000/a" }, { cited: "doi:10.1000/center" }];
  const edges = mapCitationEdges(rows, "references", "10.1000/center");
  assert.equal(edges.length, 1); assert.equal(edges[0].doi, "10.1000/a");
});
