/**
 * Ticket #76 — resolvePathForFile narrow guard.
 *
 * The preload exposes webUtils.getPathForFile behind a strict `instanceof
 * File` check so renderer code can never resolve an arbitrary value to an OS
 * path. This suite pins that contract outside Electron by injecting the
 * resolver function (the actual `webUtils` call is not available in test).
 */

import { describe, expect, it, vi } from "vitest";
import { resolvePathForFile } from "../src/preload/path-for-file.js";

describe("resolvePathForFile (ticket #76)", () => {
  it("resolves a real File via the injected resolver", () => {
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    const resolver = vi.fn(() => "/home/user/note.txt");
    expect(resolvePathForFile(file, resolver)).toBe("/home/user/note.txt");
    expect(resolver).toHaveBeenCalledWith(file);
  });

  it("returns null for non-File values without calling the resolver", () => {
    const resolver = vi.fn(() => "/whatever");
    expect(resolvePathForFile(null, resolver)).toBeNull();
    expect(resolvePathForFile(undefined, resolver)).toBeNull();
    expect(resolvePathForFile("C:\\fake\\path.txt", resolver)).toBeNull();
    expect(resolvePathForFile({ name: "x.txt" }, resolver)).toBeNull();
    expect(resolvePathForFile(42, resolver)).toBeNull();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("is null-safe when File is not defined in the environment", () => {
    // Node ≥20 defines File globally; simulate absence safely with stubGlobal
    // so this works identically on Linux, Windows, and macOS runners.
    vi.stubGlobal("File", undefined);
    try {
      expect(resolvePathForFile({}, () => "/x")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns null when the resolver throws or returns null", () => {
    const file = new File(["b"], "b.bin");
    expect(resolvePathForFile(file, () => null)).toBeNull();
    expect(resolvePathForFile(file, () => {
      throw new Error("denied");
    })).toBeNull();
  });
});