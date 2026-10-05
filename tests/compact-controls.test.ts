import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ControlPopover from "../components/ControlPopover";

test("shared compact controls have named keyboard-operable dialog triggers", () => {
  for (const label of ["Reference", "APA 6", "High"]) {
    const html = renderToStaticMarkup(createElement(ControlPopover, { label, title: `Pilih ${label}`, children: "Options" }));
    assert.match(html, /type="button"/);
    assert.match(html, /aria-haspopup="dialog"/);
    assert.match(html, /aria-expanded="false"/);
    assert.ok(html.includes(label));
  }
});
test("all source bars share compact popups and portal positioning rather than overlapping expanded selectors", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const css = readFileSync("app/globals.css", "utf8");
  const popover = readFileSync("components/ControlPopover.tsx", "utf8");
  assert.match(page, /aiSourceModelBar rbCompactBar/);
  assert.match(page, /referenceControl={<AiDatabaseSourcePicker/);
  assert.ok((page.match(/referenceControl={<AiDatabaseSourcePicker/g) || []).length >= 5);
  assert.match(css, /\.rbCompactBar[^{}]*\{[^}]*flex-wrap:nowrap!important/);
  assert.match(css, /button\.rbCompactControl[^{}]*\{[^}]*height:44px!important/);
  assert.match(css, /\.toolPlanner \{ grid-template-columns:minmax\(0,1fr\)!important; \}/);
  const alignment = readFileSync("app/layout-alignment.css", "utf8");
  assert.match(alignment, /\.gptComposer\.bottomAsk \.askTopControls>\.aiSourceModelBar\.rbCompactBar\{[^}]*display:flex!important;[^}]*flex-wrap:nowrap!important/);
  assert.doesNotMatch(alignment, /\.gptComposer\.bottomAsk \.askTopControls>\.aiSourceModelBar\{display:contents!important\}/);
  assert.match(popover, /createPortal/);
  assert.match(popover, /visualViewport/);
  assert.match(popover, /event.key === "Escape"/);
});
test("Reference selection reaches every generator as node and file arrays",()=>{
  const page=readFileSync("app/page.tsx","utf8");
  for(const prefix of ["plannerSource","practiceSource"]){
    assert.ok(page.includes(`sourceNodeIds: ${prefix}NodeIds`));
    assert.ok(page.includes(`sourceFileIds: ${prefix}FileIds`));
  }
  assert.ok(page.includes("sourceFileIds: selectedSourceFiles"));
  assert.ok(page.includes("toggleReferenceFolder(nodes,files,{nodeIds,fileIds},id)"));
  assert.ok(page.includes("aria-pressed={fileSelected}"));
});
