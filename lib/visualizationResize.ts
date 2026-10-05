/** Resize canvas/SVG renderers when their actual container changes, including
 * narrowed browser windows, side panels and nested Upload workspaces. */
export function observeVisualizationResize(host: Element | null, resize: () => void) {
  if (!host || typeof ResizeObserver === "undefined") return () => {};
  const observer = new ResizeObserver(entries => {
    if (entries.some(entry => entry.contentRect.width > 0 && entry.contentRect.height > 0)) resize();
  });
  observer.observe(host);
  return () => observer.disconnect();
}
