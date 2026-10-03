"use client";
import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode } from "react";

// Escape transformed composer/sidebar ancestors that create fixed-position containers.
export function ViewportPopover({ className, style, children }: { className: string; style: CSSProperties; children: ReactNode }) {
  return createPortal(<div className={className} style={style}>{children}</div>, document.body);
}
