"use client";

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { popoverPosition } from "./popoverPosition";

export function useViewportPopover(open: boolean, anchor: RefObject<HTMLElement | null>, close: () => void, preferredWidth = 400) {
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (!anchor.current) return;
      const viewport = window.visualViewport;
      const rect = anchor.current.getBoundingClientRect();
      const position = popoverPosition(rect, {
        width: viewport?.width ?? window.innerWidth,
        height: viewport?.height ?? window.innerHeight,
        left: viewport?.offsetLeft ?? 0,
        top: viewport?.offsetTop ?? 0,
      }, preferredWidth);
      // CSS variables override legacy composer positioning without changing other popovers.
      setStyle({
        "--rb-popover-left": `${position.left}px`,
        "--rb-popover-width": `${position.width}px`,
        "--rb-popover-top": position.top === undefined ? "auto" : `${position.top}px`,
        "--rb-popover-bottom": position.bottom === undefined ? "auto" : `${position.bottom + window.innerHeight - (viewport?.height ?? window.innerHeight) - (viewport?.offsetTop ?? 0)}px`,
        "--rb-popover-height": `${position.maxHeight}px`,
      } as CSSProperties);
    };
    const outside = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".rbViewportPopover")) return;
      if (event.target instanceof Node && !anchor.current?.contains(event.target)) closeRef.current();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeRef.current();
        anchor.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    viewportListener("addEventListener");
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keydown);
    function viewportListener(method: "addEventListener" | "removeEventListener") {
      window.visualViewport?.[method]("resize", update);
      window.visualViewport?.[method]("scroll", update);
    }
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      viewportListener("removeEventListener");
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keydown);
    };
  }, [open, anchor, preferredWidth]);
  return style;
}
