// @vitest-environment jsdom
/**
 * Ticket #74 — global window-level drop handling.
 *   * dragenter/dragover/drop must be preventDefault'd at document level so
 *     Chromium never navigates the window on a file drop.
 *   * a drag with Files shows the overlay; dragleave/drop/blur hides it.
 *   * in the agent view, a drop routes the FileList to attachFiles; elsewhere
 *     it is rejected with a clear toast.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initDropHandling } from "../src/renderer/drop-paste.js";

function installDom() {
  document.body.innerHTML = `
    <div class="shell-drop-overlay" id="shell-drop-overlay" hidden aria-hidden="true">
      <span class="shell-drop-overlay-mark" aria-hidden="true"></span>
      <strong class="shell-drop-overlay-label" data-drop-label>Drop to attach</strong>
      <span class="shell-drop-overlay-hint">Release to add files</span>
    </div>
  `;
}

function fileDragEvent(type, withFiles) {
  const dataTransfer = { types: withFiles ? ["Files"] : [], files: [], dropEffect: "" };
  // jsdom's DragEvent constructor does not carry dataTransfer; attach it after
  // construction via the legacy initializer on the event object.
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer, configurable: true });
  return event;
}

describe("initDropHandling (ticket #74)", () => {
  let attachFiles;
  let notify;
  let teardown;

  beforeEach(() => {
    installDom();
    attachFiles = vi.fn().mockResolvedValue(undefined);
    notify = vi.fn();
  });

  afterEach(() => {
    teardown?.();
    teardown = undefined;
    document.body.innerHTML = "";
  });

  function start(isAgentActive = true) {
    teardown = initDropHandling({ isAgentActive: () => isAgentActive, attachFiles, notify });
  }

  it("prevents default on dragenter/dragover/drop with files", () => {
    start();
    const enter = fileDragEvent("dragenter", true);
    const over = fileDragEvent("dragover", true);
    const drop = fileDragEvent("drop", true);
    expect(document.dispatchEvent(enter)).toBe(false); // preventDefault → dispatch returns false
    expect(document.dispatchEvent(over)).toBe(false);
    expect(document.dispatchEvent(drop)).toBe(false);
  });

  it("does not prevent non-file drags", () => {
    start();
    const enter = fileDragEvent("dragenter", false);
    const over = fileDragEvent("dragover", false);
    expect(document.dispatchEvent(enter)).toBe(true);
    expect(document.dispatchEvent(over)).toBe(true);
  });

  it("shows the overlay on dragenter and hides it on dragleave resolution", () => {
    start();
    const overlay = document.getElementById("shell-drop-overlay");
    expect(overlay.hidden).toBe(true);
    document.dispatchEvent(fileDragEvent("dragenter", true));
    expect(overlay.hidden).toBe(false);
    document.dispatchEvent(fileDragEvent("dragleave", true));
    expect(overlay.hidden).toBe(true);
  });

  it("routes dropped files to attachFiles when the agent view is active", () => {
    start(true);
    const files = [{ name: "a.png", size: 3 }];
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { types: ["Files"], files, dropEffect: "" }, configurable: true });
    document.dispatchEvent(drop);
    expect(attachFiles).toHaveBeenCalledWith(files);
    expect(notify).not.toHaveBeenCalled();
    expect(document.getElementById("shell-drop-overlay").hidden).toBe(true);
  });

  it("rejects the drop with a toast when the agent view is not active", () => {
    start(false);
    const files = [{ name: "notes.md", size: 3 }];
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { types: ["Files"], files, dropEffect: "" }, configurable: true });
    document.dispatchEvent(drop);
    expect(attachFiles).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Files can only be attached in the Agent view.", "error");
  });

  it("explains that folders belong in the Files plugin when a folder is dropped", () => {
    start(true);
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: {
        types: ["Files"],
        files: [],
        items: [{ webkitGetAsEntry: () => ({ isDirectory: true, name: "proj" }) }],
        dropEffect: "",
      },
      configurable: true,
    });
    document.dispatchEvent(drop);
    expect(attachFiles).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Folders can be dropped in the Files plugin.", "error");
  });

  it("shows a routing-aware overlay label depending on the active view", () => {
    start(false);
    document.dispatchEvent(fileDragEvent("dragenter", true));
    const label = document.querySelector("[data-drop-label]");
    expect(label.textContent).toBe("Files can only be attached in the Agent view");
  });

  it("hides the overlay when the window loses focus mid-drag", () => {
    start();
    document.dispatchEvent(fileDragEvent("dragenter", true));
    expect(document.getElementById("shell-drop-overlay").hidden).toBe(false);
    window.dispatchEvent(new Event("blur"));
    expect(document.getElementById("shell-drop-overlay").hidden).toBe(true);
  });

  it("teardown removes listeners and hides the overlay", () => {
    start();
    teardown();
    teardown = undefined;
    const enter = fileDragEvent("dragenter", true);
    expect(document.dispatchEvent(enter)).toBe(true); // no longer prevented
    expect(document.getElementById("shell-drop-overlay").hidden).toBe(true);
  });
});