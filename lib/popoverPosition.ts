/** Keep a right-aligned popup inside the visible viewport, relative to its anchor. */
export function boundedPopoverLeft(anchorLeft: number, anchorRight: number, popupWidth: number, viewportLeft: number, viewportWidth: number, gutter = 16): number {
  const minimum = viewportLeft + gutter;
  const maximum = Math.max(minimum, viewportLeft + viewportWidth - gutter - popupWidth);
  return Math.max(minimum, Math.min(anchorRight - popupWidth, maximum)) - anchorLeft;
}
