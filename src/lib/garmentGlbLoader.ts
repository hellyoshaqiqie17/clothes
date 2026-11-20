const GLB_SOURCES = [
  "/models/garment-only.glb?v=2",
  "/api/models/garment?v=2",
] as const;

let cachedGlbBufferPromise: Promise<ArrayBuffer> | null = null;

async function fetchGlbWithRetry(): Promise<ArrayBuffer> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of GLB_SOURCES) {
      try {
        const res = await fetch(url, { cache: "force-cache" });
        if (!res.ok) continue;
        const buf = await res.arrayBuffer();
        // Verify glTF binary magic header "glTF" (0x46546C67) and sensible payload size
        if (buf.byteLength > 10000) {
          const magic = new DataView(buf).getUint32(0, true);
          if (magic === 0x46546c67) {
            return buf;
          }
        }
      } catch (err) {
        lastErr = err;
      }
    }
    await new Promise<void>((resolve) =>
      window.setTimeout(resolve, attempt === 0 ? 180 : 450)
    );
  }
  throw lastErr ?? new Error("GLB fetch exhausted retries");
}

export function loadGarmentGlbBuffer(): Promise<ArrayBuffer> {
  if (!cachedGlbBufferPromise) {
    cachedGlbBufferPromise = fetchGlbWithRetry().catch((err) => {
      cachedGlbBufferPromise = null;
      throw err;
    });
  }
  return cachedGlbBufferPromise;
}

export function preloadGarmentGlb(): void {
  if (typeof window === "undefined") return;
  void loadGarmentGlbBuffer().catch(() => {
    // Retried automatically on viewer mount if network was momentarily offline
  });
}
