"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

type CytoscapeNode = { id: string; label?: string; group?: string };
type CytoscapeEdge = { source: string; target: string; label?: string };
type CytoscapePayload = {
  nodes?: CytoscapeNode[];
  edges?: CytoscapeEdge[];
  layout?: "cose" | "breadthfirst" | "circle" | "grid";
};

function safeId(value: unknown) {
  return String(value || "").trim().slice(0, 120).replace(/[^A-Za-z0-9_.:-]/g, "_");
}

function safeLabel(value: unknown) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, 280);
}

export function MermaidDiagram({ code }: { code: string }) {
  const rawId = useId();
  const renderId = useMemo(() => "rb_mermaid_" + rawId.replace(/[^A-Za-z0-9_-]/g, ""), [rawId]);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setSvg("");
    setError("");
    const definition = String(code || "").trim().slice(0, 40000);
    if (!definition) {
      setError("Diagram Mermaid kosong.");
      return;
    }

    void import("mermaid").then(async (module) => {
      const mermaid = module.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: "default",
        flowchart: { htmlLabels: false, useMaxWidth: true },
      });
      try {
        const result = await mermaid.render(renderId, definition);
        if (!cancelled) setSvg(result.svg);
      } catch (err: any) {
        if (!cancelled) setError(String(err?.message || "Diagram Mermaid tidak valid.").slice(0, 400));
      }
    }).catch((err: any) => {
      if (!cancelled) setError(String(err?.message || "Mermaid gagal dimuat.").slice(0, 400));
    });

    return () => {
      cancelled = true;
    };
  }, [code, renderId]);

  if (error) {
    return (
      <div className="learningVisualError">
        <strong>Diagram tidak dapat dirender</strong>
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="learningVisual learningMermaid" aria-label="Diagram pembelajaran Mermaid">
      {!svg && <span className="learningVisualLoading">Memuat diagram…</span>}
      {!!svg && <div className="learningMermaidSvg" dangerouslySetInnerHTML={{ __html: svg }} />}
    </div>
  );
}

function parseCytoscape(code: string) {
  const parsed = JSON.parse(code) as CytoscapePayload;
  const nodesRaw = Array.isArray(parsed?.nodes) ? parsed.nodes.slice(0, 80) : [];
  const nodeIds = new Set<string>();
  const nodes = nodesRaw.map((node) => {
    const id = safeId(node?.id);
    if (!id || nodeIds.has(id)) return null;
    nodeIds.add(id);
    return {
      data: {
        id,
        label: safeLabel(node?.label || id),
        group: safeLabel(node?.group || ""),
      },
    };
  }).filter(Boolean) as Array<{ data: { id: string; label: string; group: string } }>;

  const edges = (Array.isArray(parsed?.edges) ? parsed.edges.slice(0, 160) : [])
    .map((edge, index) => {
      const source = safeId(edge?.source);
      const target = safeId(edge?.target);
      if (!nodeIds.has(source) || !nodeIds.has(target)) return null;
      return {
        data: {
          id: "e" + index + "_" + source + "_" + target,
          source,
          target,
          label: safeLabel(edge?.label || ""),
        },
      };
    })
    .filter(Boolean) as Array<{ data: { id: string; source: string; target: string; label: string } }>;

  if (!nodes.length) throw new Error("Graph Cytoscape harus memiliki minimal satu node.");

  const allowed = new Set(["cose", "breadthfirst", "circle", "grid"]);
  const layout = allowed.has(String(parsed?.layout || "")) ? String(parsed.layout) : "cose";
  return { nodes, edges, layout };
}

export function CytoscapeDiagram({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let destroyed = false;
    let instance: any = null;
    setError("");

    let graph: ReturnType<typeof parseCytoscape>;
    try {
      graph = parseCytoscape(String(code || ""));
    } catch (err: any) {
      setError(String(err?.message || "Graph Cytoscape tidak valid.").slice(0, 400));
      return;
    }

    void import("cytoscape").then((module) => {
      if (destroyed || !containerRef.current) return;
      const cytoscape = module.default;
      const computed = getComputedStyle(containerRef.current);
      const text = computed.color || "#222";
      const border = computed.borderColor || text;
      const surface = computed.backgroundColor || "#fff";

      instance = cytoscape({
        container: containerRef.current,
        elements: [...graph.nodes, ...graph.edges],
        minZoom: 0.25,
        maxZoom: 3,
        wheelSensitivity: 0.18,
        boxSelectionEnabled: false,
        style: [
          {
            selector: "node",
            style: {
              label: "data(label)",
              color: text,
              "background-color": surface,
              "border-color": border,
              "border-width": 1.5,
              "font-size": 12,
              "text-wrap": "wrap",
              "text-max-width": 140,
              width: "label",
              height: "label",
              padding: 14,
            },
          },
          {
            selector: "edge",
            style: {
              label: "data(label)",
              color: text,
              "line-color": border,
              "target-arrow-color": border,
              "target-arrow-shape": "triangle",
              "curve-style": "bezier",
              "font-size": 10,
              "text-background-opacity": 1,
              "text-background-color": surface,
              "text-background-padding": 2,
            },
          },
          {
            selector: ":selected",
            style: {
              "border-width": 3,
              "line-width": 3,
            },
          },
        ],
        layout: {
          name: graph.layout as any,
          fit: true,
          padding: 28,
          animate: false,
        },
      });
    }).catch((err: any) => {
      if (!destroyed) setError(String(err?.message || "Cytoscape gagal dimuat.").slice(0, 400));
    });

    return () => {
      destroyed = true;
      try { instance?.destroy(); } catch {}
    };
  }, [code]);

  if (error) {
    return (
      <div className="learningVisualError">
        <strong>Graph tidak dapat dirender</strong>
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="learningVisual learningCytoscape" aria-label="Graph konsep interaktif">
      <div ref={containerRef} className="learningCytoscapeCanvas" />
      <small>Drag node · scroll untuk zoom · drag ruang kosong untuk pan</small>
    </div>
  );
}
