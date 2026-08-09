// @vitest-environment jsdom
/**
 * Ticket #75 — agent composer drag & drop → attachments.
 *
 * The `addAttachments` pipeline (byte-sniffing, 4-file / 4-MiB limits, model
 * capability gating) already existed for the file picker; this suite pins the
 * same behavior when a FileList arrives from the drop path so the two entry
 * points stay equivalent.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentConversationController } from "../src/renderer/agent-conversation-controller.js";

function installDom() {
  document.body.innerHTML = `
    <form id="agent-form">
      <textarea id="agent-input" rows="1"></textarea>
      <div id="agent-attachments"></div>
      <button id="agent-send-btn" type="submit"></button>
      <button id="agent-stop-btn" hidden></button>
      <span id="agent-provider-status"></span>
    </form>
    <button id="agent-attach-btn" type="button"></button>
    <button id="agent-workspace-btn" type="button"></button>
    <input id="agent-file-input" type="file">
    <button id="agent-new-conversation"></button>
    <button id="agent-delete-close"></button>
    <button id="agent-delete-cancel"></button>
    <button id="agent-delete-confirm"></button>
    <div id="agent-delete-overlay" hidden></div>
    <div id="agent-delete-dialog" hidden></div>
    <div id="agent-conversation-list"></div>
    <div id="agent-conversation-count"></div>
    <input id="agent-conversation-search">
    <div id="agent-conversation-search-wrap"></div>
    <div id="agent-thread"></div>
    <div id="agent-mobile-conversations-btn"></div>
    <div id="agent-mobile-conversations-overlay"></div>
    <div id="agent-room-info-trigger"></div>
    <button id="agent-room-info-close"></button>
    <div id="agent-room-info"></div>
  `;
  globalThis.$ = (selector) => document.querySelector(selector);
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as never;
}

function makeController({ model = null, vision = "auto" } = {}) {
  const notify = vi.fn();
  const controller = new AgentConversationController({
    shell: { agentConversations: {} },
    getActiveModel: () => model,
    getVisionMode: () => vision,
    notify,
    log: vi.fn(),
  } as never);
  controller.renderAttachments = vi.fn(controller.renderAttachments.bind(controller));
  return { controller, notify };
}

// Minimal PNG bytes (1×1, real magic signature).
const PNG_BYTES = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
const PDF_BYTES = Uint8Array.from([37, 80, 68, 70, 45, 49, 46, 52, 10]);
const TEXT = new TextEncoder().encode("hello from a dropped utf-8 file");

function makeFile(name, bytes, opts = {}) {
  return new File([bytes], name, opts);
}

async function attachAsFileList(controller, files) {
  // addAttachments spreads the input (i.e. `[...(fileList ?? [])]`), so an
  // array of File objects is a valid stand-in for a DataTransfer FileList in
  // jsdom (which does not implement DataTransfer).
  return controller.addAttachments(files);
}

describe("AgentConversationController — drop attachments (ticket #75)", () => {
  beforeEach(installDom);

  it("attaches a PNG drop as an image chip", async () => {
    const { controller, notify } = makeController({ model: { id: "m", inputModes: ["image"] } });
    await attachAsFileList(controller, [makeFile("shot.png", PNG_BYTES, { type: "image/png" })]);
    expect(controller.attachments).toHaveLength(1);
    expect(controller.attachments[0].type).toBe("image");
    expect(controller.attachments[0].dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    const chips = document.querySelectorAll("#agent-attachments .agent-attachment");
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toContain("shot.png");
  });

  it("attaches a PDF drop as a file chip", async () => {
    const { controller } = makeController({ model: { id: "m", inputModes: ["file", "pdf"] } });
    await attachAsFileList(controller, [makeFile("report.pdf", PDF_BYTES, { type: "application/pdf" })]);
    expect(controller.attachments).toHaveLength(1);
    expect(controller.attachments[0].type).toBe("file");
  });

  it("attaches UTF-8 text without trusting the MIME type", async () => {
    const { controller } = makeController();
    await attachAsFileList(controller, [makeFile("note.txt", TEXT, { type: "application/octet-stream" })]);
    expect(controller.attachments).toHaveLength(1);
    expect(controller.attachments[0].type).toBe("text");
    expect(controller.attachments[0].content).toBe("hello from a dropped utf-8 file");
  });

  it("rejects an unsupported binary drop with the canonical toast", async () => {
    const { controller, notify } = makeController({ model: { id: "m", inputModes: ["file"] } });
    const exe = new Uint8Array([77, 90, 144, 0, 3, 0, 0, 0, 4, 0, 0, 0]);
    await attachAsFileList(controller, [makeFile("tool.exe", exe)]);
    expect(controller.attachments).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith("tool.exe is not a supported image, PDF, or UTF-8 text file.", "error");
  });

  it("enforces the 4-file-per-turn cap from the drop path", async () => {
    const { controller, notify } = makeController({ model: { id: "m", inputModes: ["file", "pdf", "image"] } });
    const files = Array.from({ length: 6 }, (_, i) => makeFile(`f${i}.pdf`, PDF_BYTES));
    await attachAsFileList(controller, files);
    expect(controller.attachments).toHaveLength(4);
    expect(notify).toHaveBeenCalledWith("A turn can include up to 4 attachments.", "error");
  });

  it("enforces the 4-MiB-per-file cap from the drop path", async () => {
    const { controller, notify } = makeController({ model: { id: "m", inputModes: ["file", "pdf"] } });
    const big = makeFile("big.pdf", new Uint8Array(4 * 1024 * 1024 + 1));
    await attachAsFileList(controller, [big]);
    expect(controller.attachments).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith("big.pdf is larger than 4 MiB.", "error");
  });

  it("rejects a drop when the active model has image input disabled", async () => {
    const { controller, notify } = makeController({ model: { id: "m", inputModes: [] }, vision: "off" });
    await attachAsFileList(controller, [makeFile("img.png", PNG_BYTES)]);
    expect(controller.attachments).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith("m has image input disabled in runtime settings.", "error");
  });

  it("clears the file input value after processing a drop", async () => {
    const { controller } = makeController({ model: { id: "m", inputModes: ["image"] } });
    const input = document.getElementById("agent-file-input");
    // Simulate a leftover value from a previous picker selection.
    Object.defineProperty(input, "value", { writable: true, value: "C:\\fakepath\\shot.png" });
    await attachAsFileList(controller, [makeFile("shot.png", PNG_BYTES)]);
    expect(input.value).toBe("");
  });
});