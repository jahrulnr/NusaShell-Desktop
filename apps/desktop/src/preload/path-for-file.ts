/**
 * Narrow guard for resolving the OS path of a File that arrived via drag &
 * drop or a file input.
 *
 * Electron 33 removed `File.path`; the supported API is
 * `webUtils.getPathForFile`, which lives in the preload context. This helper
 * keeps the guard logic pure so it can be unit tested outside Electron: the
 * actual `webUtils` call is injected.
 */

/**
 * @param file The value passed from the renderer (must be a real File).
 * @param resolve Resolver that turns a File into an OS path (preload passes
 *   `(f) => webUtils.getPathForFile(f) ?? null`).
 * @returns The absolute path string, or null when the value is not a File or
 *   the path cannot be resolved.
 */
export function resolvePathForFile(
  file: unknown,
  resolve: (file: File) => string | null,
): string | null {
  if (typeof File === "undefined" || !(file instanceof File)) return null;
  try {
    return resolve(file) ?? null;
  } catch {
    return null;
  }
}