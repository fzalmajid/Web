import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";

// Execute actual page controllers with substituted state/services. This keeps
// tests tied to behavior without importing browser/worker/rendering code or
// relying on duplicate text patterns after controller refactors.
const page = ts.createSourceFile("app/page.tsx", readFileSync(join(process.cwd(), "app/page.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map<string, string>();
function collect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node.getText(page));
  ts.forEachChild(node, collect);
}
collect(page);

export function pageFunctions(names: string[], bindings: Record<string, any>): Record<string, (...args: any[]) => any> {
  const source = names.map(name => {
    const declaration = declarations.get(name);
    if (!declaration) throw new Error("Page controller not found: " + name);
    return declaration;
  }).join("\n");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } });
  return new vm.Script(`(function () { ${outputText}\nreturn { ${names.join(",")} }; })()`, { filename: "page-controller-test.js" })
    .runInNewContext(bindings, { timeout: 1000 });
}
