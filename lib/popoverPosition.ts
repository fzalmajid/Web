export function popoverPosition(anchor: { left: number; bottom: number; top: number; width: number }, viewport: { width: number; height: number; left?: number; top?: number }, preferredWidth: number) {
  const margin = 12;
  const leftEdge = (viewport.left ?? 0) + margin;
  const topEdge = (viewport.top ?? 0) + margin;
  const width = Math.min(preferredWidth, Math.max(0, viewport.width - margin * 2));
  const rightEdge = leftEdge + viewport.width - margin * 2;
  const bottomEdge = topEdge + viewport.height - margin * 2;
  const anchorTop = Math.min(anchor.top - 8, bottomEdge);
  const above = Math.max(0, anchorTop - topEdge);
  const below = Math.max(0, bottomEdge - anchor.bottom - 8);
  const upward = above >= Math.min(280, below);
  return {
    left: Math.max(leftEdge, Math.min(anchor.left + anchor.width - width, rightEdge - width)),
    width,
    top: upward ? undefined : Math.max(topEdge, Math.min(anchor.bottom + 8, bottomEdge)),
    bottom: upward ? Math.max(margin, viewport.height + (viewport.top ?? 0) - anchorTop) : undefined,
    maxHeight: upward ? above : below,
  };
}
