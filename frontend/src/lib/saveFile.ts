/** Saves text content to a file the user picks, working in both contexts
 * this app runs in:
 *  - Inside the Tauri desktop shell: browsers' `<a download>` trick is
 *    unreliable in a WebView2 host (it can silently no-op instead of
 *    opening the OS save dialog), so this uses Tauri's own dialog + fs
 *    plugins for a real native "Save As" prompt.
 *  - In a plain browser (e.g. `npm run dev` without the Tauri shell, or
 *    this file loaded directly for testing): falls back to the standard
 *    Blob + anchor-download approach, which behaves normally there.
 */
export async function saveTextFile(content: string, filename: string, mimeType: string): Promise<void> {
  const { isTauri } = await import("@tauri-apps/api/core");
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const ext = filename.split(".").pop();
    const path = await save({
      defaultPath: filename,
      filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined,
    });
    if (!path) return; // user cancelled
    await writeTextFile(path, content);
    return;
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Same as `saveTextFile` but for binary content (PNG/PDF exports). */
export async function saveBinaryFile(data: Uint8Array, filename: string, mimeType: string): Promise<void> {
  const { isTauri } = await import("@tauri-apps/api/core");
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const ext = filename.split(".").pop();
    const path = await save({
      defaultPath: filename,
      filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined,
    });
    if (!path) return; // user cancelled
    await writeFile(path, data);
    return;
  }

  const copy = new ArrayBuffer(data.byteLength);
  new Uint8Array(copy).set(data);
  const blob = new Blob([copy], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
