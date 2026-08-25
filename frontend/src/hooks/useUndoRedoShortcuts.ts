import { useEffect } from "react";

import { redo, undo } from "../store/useNetworkStore";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // Handsontable keeps a single hidden textarea permanently focused as its
  // keyboard-capture proxy for cell navigation -- it's the event target for
  // Ctrl+Z even when no cell is actually being text-edited, so treating it
  // like a normal text field would silently swallow the global shortcut
  // every time a spreadsheet cell is merely selected.
  if (target.hasAttribute("data-hot-input")) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

/** Global Ctrl/Cmd+Z (undo) and Ctrl/Cmd+Shift+Z or Ctrl+Y (redo) shortcuts.
 * Skipped while a text field is focused so a field's own native undo (e.g.
 * while renaming a node) takes precedence over jumping the whole app's
 * history.
 *
 * Registered on the *capture* phase and stops the event outright: the CPT
 * grid (Handsontable) ships its own Ctrl+Z/Y undo plugin, and disabling it
 * via its documented settings/plugin API doesn't reliably take effect once
 * the plugin's already initialized -- left alone it fires on its own bubble
 * -phase handler and races this one over the same edit, silently
 * cancelling it out. Capturing first and stopping propagation keeps this
 * one history authoritative everywhere, cells included. */
export function useUndoRedoShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod || isEditableTarget(event.target)) return;

      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        event.stopImmediatePropagation();
        redo();
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);
}
