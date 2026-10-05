"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Shared viewport-bound popup, independent of clipped/scrolling parent panels. */
export default function ControlPopover({ label, title, children, active = false, disabled = false, open: controlledOpen, onOpenChange }: {
  label: string; title: string; children: ReactNode; active?: boolean; disabled?: boolean;
  open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (next: boolean) => { setLocalOpen(next); onOpenChange?.(next); };
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open || disabled) return;
    const popup = panel.current;
    const anchor = trigger.current;
    if (!popup || !anchor) return;
    const viewport = window.visualViewport;
    const position = () => {
      const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
      const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
      const a = anchor.getBoundingClientRect();
      const above = a.top - top - 20, below = top + height - a.bottom - 20;
      popup.style.maxWidth = `${Math.max(0, width - 24)}px`;
      // Scroll a long source tree inside the available side instead of covering
      // the trigger bar when the viewport is short.
      popup.style.maxHeight = `${Math.max(0, Math.min(height - 24, Math.max(above, below)))}px`;
      const p = popup.getBoundingClientRect();
      popup.style.left = `${Math.max(left + 12, Math.min(a.right - p.width, left + width - p.width - 12))}px`;
      const desired = a.bottom + p.height + 20 <= top + height ? a.bottom + 8 : a.top - p.height - 8;
      popup.style.top = `${Math.max(top + 12, Math.min(desired, top + height - p.height - 12))}px`;
    };
    position();
    popup.querySelector<HTMLElement>("button, input, [tabindex='0']")?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popup.contains(target) && !anchor.contains(target)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); anchor.focus(); }
    };
    const observer = new ResizeObserver(position);
    observer.observe(anchor); observer.observe(popup);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    viewport?.addEventListener("resize", position); viewport?.addEventListener("scroll", position);
    document.addEventListener("pointerdown", outside); popup.addEventListener("keydown", key);
    return () => {
      if (popup.contains(document.activeElement)) anchor.focus();
      observer.disconnect(); window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true);
      viewport?.removeEventListener("resize", position); viewport?.removeEventListener("scroll", position);
      document.removeEventListener("pointerdown", outside); popup.removeEventListener("keydown", key);
    };
  }, [open, disabled]);
  return <div className="rbControlPopover">
    <button ref={trigger} type="button" className={`rbCompactControl${active ? " active" : ""}`} disabled={disabled}
      title={title} aria-label={title} aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? id : undefined}
      onClick={() => setOpen(!open)}><span>{label}</span><svg className="rbControlChevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
    {open && !disabled && typeof document !== "undefined" && createPortal(<div ref={panel} id={id} className="rbControlPanel" role="dialog" aria-label={title}>
      <div className="rbControlPanelHead"><strong>{title}</strong><button type="button" aria-label="Tutup pilihan" onClick={() => {setOpen(false); trigger.current?.focus();}}><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="m4 4 8 8m0-8-8 8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg></button></div>
      {children}
    </div>, document.body)}
  </div>;
}
