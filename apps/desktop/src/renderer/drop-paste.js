// Global drag & drop handling for the NusaShell launcher window.
//
// Ticket #74 — before this module, the shell had zero HTML5 DnD handlers, so
// dragging a file from the OS over the window triggered Chromium's default
// behavior (navigate / error) with no affordance at all.
//
// Responsibilities:
//   * preventDefault on document-level dragenter / dragover / drop so the
//     window never navigates away from a drop.
//   * show a non-blocking overlay while a drag is in-flight (dragenter) and
//     hide it on dragleave / drop / window blur.
//   * route the dropped FileList to the active surface. In the launcher this
//     is the agent composer when the agent view is active; other views get a
//     clear "not supported here" toast instead of a silent no-op.
//
// This stays headless and dependency-free so the routing hooks are injected by
// the caller (launcher.js). Selecting the surface is a product decision that
// belongs in the caller, not here.

const overlayId = "shell-drop-overlay";

let dragDepth = 0;

function overlay() {
  return document.getElementById(overlayId);
}

function showOverlay(label) {
  const node = overlay();
  if (!node) return;
  const text = node.querySelector("[data-drop-label]");
  if (text) text.textContent = label;
  node.hidden = false;
}

function hideOverlay() {
  dragDepth = 0;
  const node = overlay();
  if (node) node.hidden = true;
}

/**
 * @param {DragEvent} event
 * @returns {boolean} true when the drag carries file entries.
 */
function hasFiles(event) {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  // Chromium exposes "Files" in the type list while a file drag is in-flight;
  // Firefox uses application/x-moz-file.
  return [...types].some((type) => type === "Files" || type === "application/x-moz-file");
}

/**
 * A folder drop typically arrives with an empty FileList but non-empty
 * DataTransferItems whose webkitGetAsEntry() reports a directory.
 * @param {DragEvent} event
 */
function looksLikeFolderDrop(event) {
  const items = [...(event.dataTransfer?.items ?? [])];
  if (items.length === 0) return false;
  return items.every((item) => {
    const entry = item.webkitGetAsEntry?.();
    return Boolean(entry?.isDirectory);
  });
}

/**
 * Init global drop handling on the document.
 *
 * @param {object} hooks
 * @param {() => boolean} hooks.isAgentActive  true when the agent composer is the target surface
 * @param {(fileList: FileList) => Promise<void> | void} hooks.attachFiles routes a dropped FileList
 * @param {(message: string, kind?: string) => void} hooks.notify toast helper
 * @returns {() => void} teardown that removes all listeners
 */
export function initDropHandling({ isAgentActive, attachFiles, notify }) {
  const onDragEnter = (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    showOverlay(isAgentActive() ? "Drop to attach to your message" : "Files can only be attached in the Agent view");
  };

  const onDragOver = (event) => {
    if (!hasFiles(event)) return;
    // Required to make the browser treat this document as a valid drop target.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };

  const onDragLeave = (event) => {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) hideOverlay();
  };

  const onDrop = (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    hideOverlay();
    const files = event.dataTransfer?.files;
    const fileList = files && files.length > 0 ? files : null;
    if (!fileList && looksLikeFolderDrop(event)) {
      notify("Folders can be dropped in the Files plugin.", "error");
      return;
    }
    if (!fileList) return;
    if (isAgentActive()) {
      void Promise.resolve(attachFiles(fileList)).catch((error) => {
        notify(error instanceof Error ? error.message : String(error), "error");
      });
    } else {
      notify("Files can only be attached in the Agent view.", "error");
    }
  };

  const onBlur = () => hideOverlay();

  document.addEventListener("dragenter", onDragEnter);
  document.addEventListener("dragover", onDragOver);
  document.addEventListener("dragleave", onDragLeave);
  document.addEventListener("drop", onDrop);
  // Safety net: hide the overlay if the window loses focus mid-drag (drop on
  // another surface, Alt+Tab, etc.), so it never sticks around.
  window.addEventListener("blur", onBlur);

  return () => {
    document.removeEventListener("dragenter", onDragEnter);
    document.removeEventListener("dragover", onDragOver);
    document.removeEventListener("dragleave", onDragLeave);
    document.removeEventListener("drop", onDrop);
    window.removeEventListener("blur", onBlur);
    hideOverlay();
  };
}