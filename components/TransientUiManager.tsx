"use client";

import { useEffect } from "react";

type TransientRule = {
  overlay: string;
  trigger: (overlay: Element) => HTMLElement | null;
};

const rules: TransientRule[] = [
  {
    overlay: ".socialRoomMenu",
    trigger: (overlay) =>
      overlay.closest(".socialRoomCard")?.querySelector<HTMLElement>(".socialRoomDots") || null,
  },
  {
    overlay: ".leftChatItemMenu",
    trigger: (overlay) =>
      overlay.closest(".leftChatHistoryItem")?.querySelector<HTMLElement>(".leftChatMoreButton") || null,
  },
  {
    overlay: ".leftChatAccountMenu",
    trigger: () => document.querySelector<HTMLElement>(".leftChatAccountButton"),
  },
  {
    overlay: ".themeMenu",
    trigger: (overlay) =>
      overlay.closest(".themePicker")?.querySelector<HTMLElement>(".themeTrigger") || null,
  },
  {
    overlay: ".aiModePopover",
    trigger: (overlay) =>
      overlay.closest(".aiModeSelect")?.querySelector<HTMLElement>(".aiModeTrigger") || null,
  },
  {
    overlay: ".citationPopover",
    trigger: (overlay) =>
      overlay.closest(".citationPicker")?.querySelector<HTMLElement>(".citationTrigger") || null,
  },
  {
    overlay: ".aiDatabaseSourcePopover",
    trigger: (overlay) =>
      overlay.closest(".aiDatabaseSourcePicker")?.querySelector<HTMLElement>(".chooseSourcesTrigger") || null,
  },
  {
    overlay: ".askAttachMenu",
    trigger: () => document.querySelector<HTMLElement>(".askAttach"),
  },
];

function clickTrigger(trigger: HTMLElement | null) {
  if (!trigger || trigger.hasAttribute("disabled")) return;
  trigger.click();
}

export default function TransientUiManager() {
  useEffect(() => {
    let syntheticDismiss = false;

    const closeExplorerContext = (target: Element | null) => {
      const layer = document.querySelector<HTMLElement>(".contextDismissLayer");
      if (!layer) return;
      const menu = layer.querySelector<HTMLElement>(".explorerContextMenu");
      if (target && menu?.contains(target)) return;

      syntheticDismiss = true;
      layer.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          view: window,
        })
      );
      syntheticDismiss = false;
    };

    const dismissOthers = (event: Event) => {
      if (syntheticDismiss) return;
      const target = event.target instanceof Element ? event.target : null;

      // Explorer's old full-screen dismissal layer must not consume the next
      // right-click. Close it first, then let the original event continue to
      // the newly targeted card.
      closeExplorerContext(target);

      for (const rule of rules) {
        const overlays = Array.from(document.querySelectorAll<HTMLElement>(rule.overlay));
        for (const overlay of overlays) {
          if (target && overlay.contains(target)) continue;

          const trigger = rule.trigger(overlay);
          if (target && trigger?.contains(target)) continue;

          syntheticDismiss = true;
          clickTrigger(trigger);
          syntheticDismiss = false;
        }
      }
    };

    const closeAll = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      dismissOthers(event);
    };

    // Capture phase is intentional: old transient UI closes before the target's
    // own handler opens the next menu/popover.
    document.addEventListener("pointerdown", dismissOthers, true);
    document.addEventListener("contextmenu", dismissOthers, true);
    document.addEventListener("keydown", closeAll, true);

    return () => {
      document.removeEventListener("pointerdown", dismissOthers, true);
      document.removeEventListener("contextmenu", dismissOthers, true);
      document.removeEventListener("keydown", closeAll, true);
    };
  }, []);

  return null;
}
