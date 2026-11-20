import type {
  CatalogProduct,
  GarmentMapping,
} from "@/types/catalog";

export interface BuiltGarmentTextures {
  atlasCanvas: HTMLCanvasElement;
  extractedHex: string;
  front2dDataUrl: string;
  back2dDataUrl: string;
  mappingSummary: string;
}

interface CutoutResult {
  canvas: HTMLCanvasElement;
  dominantHex: string;
  patchCanvas: HTMLCanvasElement;
  hasAlphaCutout: boolean;
}

// Exact pixel bounding boxes measured from runway-human.glb UV layouts (1024x1024, flipY=false)
const TOP_UV = {
  front: { x: 396, y: 448, w: 420, h: 536 },
  back: { x: 6, y: 466, w: 404, h: 524 },
  rightSleeve: { x: 118, y: 12, w: 404, h: 452 },
  leftSleeve: { x: 530, y: 4, w: 426, h: 452 },
};

const BOTTOM_UV = {
  frontRightLeg: { x: 4, y: 218, w: 270, h: 786 },
  backLeftLeg: { x: 280, y: 218, w: 238, h: 786 },
  frontLeftLeg: { x: 520, y: 218, w: 254, h: 786 },
  backRightLeg: { x: 778, y: 218, w: 242, h: 786 },
  waistband: { x: 0, y: 124, w: 660, h: 96 },
};

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [clampByte(r), clampByte(g), clampByte(b)]
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("")
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16),
      parseInt(clean[1] + clean[1], 16),
      parseInt(clean[2] + clean[2], 16),
    ];
  }
  const num = parseInt(clean.slice(0, 6), 16);
  if (Number.isNaN(num)) return [55, 63, 71];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function colorDistSq(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

function colorDist(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number
): number {
  return Math.sqrt(colorDistSq(r1, g1, b1, r2, g2, b2));
}

function isConstrainedDevice(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const veryLowMem =
    typeof nav.deviceMemory === "number" && nav.deviceMemory <= 2;
  const lowMem = typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4;
  const lowCores =
    typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency <= 4;
  const narrowOrTouch =
    window.innerWidth < 768 ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches);
  return veryLowMem || (narrowOrTouch && (lowMem || lowCores));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      if (typeof img.decode === "function") {
        img
          .decode()
          .then(() => resolve(img))
          .catch(() => resolve(img));
      } else {
        resolve(img);
      }
    };
    img.onerror = () => reject(new Error("Failed to load garment image"));
    img.src = src;
  });
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

/**
 * Flood-fills uniform studio background from image borders without punching out
 * bright interior graphics, trims to tight garment bounds, and synthesizes a
 * seamless fabric swatch from clean interior pixels.
 */
function analyzeAndIsolateGarment(
  img: HTMLImageElement,
  autoRemoveBackground: boolean,
  constrained: boolean
): CutoutResult {
  const analysisDim = constrained ? 144 : 180;
  const scale = Math.min(1, analysisDim / Math.max(img.width, img.height));
  const w = Math.max(32, Math.round(img.width * scale));
  const h = Math.max(32, Math.round(img.height * scale));

  const work = createCanvas(w, h);
  const ctx = work.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);

  const hiCap = constrained ? 640 : 840;

  let imgData: ImageData;
  try {
    imgData = ctx.getImageData(0, 0, w, h);
  } catch {
    // Cross-origin tainted image fallback: preserve high-res uncropped image safely
    const fbScale = Math.min(1, hiCap / Math.max(img.width, img.height));
    const fbW = Math.max(32, Math.round(img.width * fbScale));
    const fbH = Math.max(32, Math.round(img.height * fbScale));
    const hiFallback = createCanvas(fbW, fbH);
    const fbCtx = hiFallback.getContext("2d")!;
    fbCtx.imageSmoothingEnabled = true;
    fbCtx.imageSmoothingQuality = "high";
    fbCtx.drawImage(img, 0, 0, fbW, fbH);

    const patchCanvas = createCanvas(128, 128);
    const pCtx = patchCanvas.getContext("2d")!;
    pCtx.imageSmoothingEnabled = true;
    pCtx.imageSmoothingQuality = "high";
    pCtx.drawImage(hiFallback, 0, 0, fbW, fbH, 0, 0, 128, 128);
    return {
      canvas: hiFallback,
      patchCanvas,
      dominantHex: "",
      hasAlphaCutout: false,
    };
  }
  const data = imgData.data;

  let transparentPerimeter = 0;
  let perimeterTotal = 0;
  const borderSamples: [number, number, number][] = [];

  for (let x = 0; x < w; x++) {
    for (const y of [0, 1, h - 2, h - 1]) {
      const idx = (y * w + x) * 4;
      perimeterTotal++;
      if (data[idx + 3] < 40) transparentPerimeter++;
      else borderSamples.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
  }
  for (let y = 0; y < h; y++) {
    for (const x of [0, 1, w - 2, w - 1]) {
      const idx = (y * w + x) * 4;
      perimeterTotal++;
      if (data[idx + 3] < 40) transparentPerimeter++;
      else borderSamples.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
  }

  const hasNativeAlpha = transparentPerimeter > perimeterTotal * 0.08;
  let hasAlphaCutout = hasNativeAlpha;
  let maskCanvas: HTMLCanvasElement | null = null;

  if (autoRemoveBackground && !hasNativeAlpha && borderSamples.length > 8) {
    let meanR = 0;
    let meanG = 0;
    let meanB = 0;
    for (const [r, g, b] of borderSamples) {
      meanR += r;
      meanG += g;
      meanB += b;
    }
    meanR /= borderSamples.length;
    meanG /= borderSamples.length;
    meanB /= borderSamples.length;

    let varianceSum = 0;
    for (const [r, g, b] of borderSamples) {
      varianceSum += colorDist(r, g, b, meanR, meanG, meanB);
    }
    const borderSpread = varianceSum / borderSamples.length;

    if (borderSpread < 34) {
      // Compare center garment color vs border backdrop so dark garments strip soft shadows cleanly
      // while cream/white garments on light backdrops keep a tight safe tolerance
      let cR = 0;
      let cG = 0;
      let cB = 0;
      let cCount = 0;
      const cx0 = Math.floor(w * 0.35);
      const cx1 = Math.ceil(w * 0.65);
      const cy0 = Math.floor(h * 0.35);
      const cy1 = Math.ceil(h * 0.65);
      for (let y = cy0; y < cy1; y += 2) {
        for (let x = cx0; x < cx1; x += 2) {
          const idx = (y * w + x) * 4;
          cR += data[idx];
          cG += data[idx + 1];
          cB += data[idx + 2];
          cCount++;
        }
      }
      const contrast =
        cCount > 0
          ? colorDist(cR / cCount, cG / cCount, cB / cCount, meanR, meanG, meanB)
          : 40;
      const tolerance =
        contrast < 35
          ? Math.max(10, Math.min(18, borderSpread * 2.2 + 8))
          : Math.max(28, Math.min(54, contrast * 0.32));
      const tolSq = tolerance * tolerance;
      const visited = new Uint8Array(w * h);
      const isBg = new Uint8Array(w * h);
      const queue = new Int32Array(w * h);
      let head = 0;
      let tail = 0;

      const trySeed = (px: number, py: number) => {
        const pos = py * w + px;
        if (visited[pos]) return;
        const idx = pos * 4;
        if (
          colorDistSq(data[idx], data[idx + 1], data[idx + 2], meanR, meanG, meanB) <=
          tolSq
        ) {
          visited[pos] = 1;
          isBg[pos] = 1;
          queue[tail++] = pos;
        }
      };

      for (let x = 0; x < w; x++) {
        trySeed(x, 0);
        trySeed(x, h - 1);
      }
      for (let y = 0; y < h; y++) {
        trySeed(0, y);
        trySeed(w - 1, y);
      }

      const tryVisit = (nPos: number) => {
        if (visited[nPos]) return;
        visited[nPos] = 1;
        const idx = nPos * 4;
        if (
          colorDistSq(data[idx], data[idx + 1], data[idx + 2], meanR, meanG, meanB) <=
          tolSq
        ) {
          isBg[nPos] = 1;
          queue[tail++] = nPos;
        }
      };

      while (head < tail) {
        const curr = queue[head++];
        const cx = curr % w;
        const cy = (curr - cx) / w;
        if (cx > 0) tryVisit(curr - 1);
        if (cx < w - 1) tryVisit(curr + 1);
        if (cy > 0) tryVisit(curr - w);
        if (cy < h - 1) tryVisit(curr + w);
      }

      const removedRatio = tail / (w * h);
      if (removedRatio > 0.04 && removedRatio < 0.78) {
        hasAlphaCutout = true;
        maskCanvas = createCanvas(w, h);
        const maskCtx = maskCanvas.getContext("2d")!;
        const maskData = maskCtx.createImageData(w, h);
        const mPixels = maskData.data;

        for (let i = 0; i < w * h; i++) {
          const mIdx = i * 4;
          mPixels[mIdx] = 255;
          mPixels[mIdx + 1] = 255;
          mPixels[mIdx + 2] = 255;
          if (isBg[i]) {
            data[i * 4 + 3] = 0;
            mPixels[mIdx + 3] = 0;
          } else {
            const x = i % w;
            const y = (i - x) / w;
            let bgNeighbors = 0;
            if (x > 0 && isBg[i - 1]) bgNeighbors++;
            if (x < w - 1 && isBg[i + 1]) bgNeighbors++;
            if (y > 0 && isBg[i - w]) bgNeighbors++;
            if (y < h - 1 && isBg[i + w]) bgNeighbors++;
            const alpha =
              bgNeighbors > 0
                ? Math.round(data[i * 4 + 3] * (1 - bgNeighbors * 0.16))
                : data[i * 4 + 3];
            data[i * 4 + 3] = alpha;
            mPixels[mIdx + 3] = alpha;
          }
        }
        maskCtx.putImageData(maskData, 0, 0);
      }
    }
  }

  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  const fgSamples: [number, number, number][] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (data[idx + 3] > 80) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x % 6 === 0 && y % 6 === 0) {
          fgSamples.push([data[idx], data[idx + 1], data[idx + 2]]);
        }
      }
    }
  }

  if (maxX <= minX || maxY <= minY) {
    minX = 0;
    minY = 0;
    maxX = w - 1;
    maxY = h - 1;
  }

  const cropW = Math.max(16, maxX - minX + 1);
  const cropH = Math.max(16, maxY - minY + 1);

  // Composite directly from full-resolution source image so prints and fabric grain stay crisp
  const srcMinX = (minX / w) * img.width;
  const srcMinY = (minY / h) * img.height;
  const srcCropW = Math.max(16, (cropW / w) * img.width);
  const srcCropH = Math.max(16, (cropH / h) * img.height);
  const hiScale = Math.min(1, hiCap / Math.max(srcCropW, srcCropH));
  const hiW = Math.max(32, Math.round(srcCropW * hiScale));
  const hiH = Math.max(32, Math.round(srcCropH * hiScale));

  const hiCropped = createCanvas(hiW, hiH);
  const hiCtx = hiCropped.getContext("2d")!;
  hiCtx.imageSmoothingEnabled = true;
  hiCtx.imageSmoothingQuality = "high";
  hiCtx.drawImage(img, srcMinX, srcMinY, srcCropW, srcCropH, 0, 0, hiW, hiH);

  if (maskCanvas) {
    hiCtx.save();
    hiCtx.globalCompositeOperation = "destination-in";
    hiCtx.imageSmoothingEnabled = true;
    hiCtx.imageSmoothingQuality = "high";
    hiCtx.drawImage(maskCanvas, minX, minY, cropW, cropH, 0, 0, hiW, hiH);
    hiCtx.restore();
  }

  let dominantHex = "#3A4048";
  if (fgSamples.length > 0) {
    const rList = fgSamples.map((s) => s[0]).sort((a, b) => a - b);
    const gList = fgSamples.map((s) => s[1]).sort((a, b) => a - b);
    const bList = fgSamples.map((s) => s[2]).sort((a, b) => a - b);
    const mid = Math.floor(fgSamples.length / 2);
    dominantHex = rgbToHex(rList[mid], gList[mid], bList[mid]);
  }

  const patchCanvas = buildSeamlessFabricPatch(
    hiCropped,
    data,
    w,
    minX,
    minY,
    cropW,
    cropH,
    dominantHex,
    constrained
  );

  return {
    canvas: hiCropped,
    dominantHex,
    patchCanvas,
    hasAlphaCutout,
  };
}

function buildSeamlessFabricPatch(
  hiCropped: HTMLCanvasElement,
  fullData: Uint8ClampedArray,
  fullW: number,
  minX: number,
  minY: number,
  cropW: number,
  cropH: number,
  dominantHex: string,
  constrained: boolean
): HTMLCanvasElement {
  const [domR, domG, domB] = hexToRgb(dominantHex);
  const patchSize = constrained ? 192 : 256;
  const out = createCanvas(patchSize, patchSize);
  const oCtx = out.getContext("2d")!;
  oCtx.imageSmoothingEnabled = true;
  oCtx.imageSmoothingQuality = "high";

  oCtx.fillStyle = dominantHex;
  oCtx.fillRect(0, 0, patchSize, patchSize);

  const sampleSize = Math.max(18, Math.min(56, Math.floor(Math.min(cropW, cropH) * 0.16)));
  let bestScore = Number.POSITIVE_INFINITY;
  let bestRect = {
    sx: Math.floor(cropW * 0.25),
    sy: Math.floor(cropH * 0.65),
  };

  const candidates: [number, number][] = [
    [0.18, 0.72],
    [0.64, 0.72],
    [0.16, 0.24],
    [0.68, 0.24],
    [0.36, 0.78],
    [0.38, 0.18],
    [0.24, 0.48],
    [0.62, 0.48],
  ];

  for (const [rx, ry] of candidates) {
    const sx = Math.max(0, Math.min(cropW - sampleSize, Math.floor(cropW * rx)));
    const sy = Math.max(0, Math.min(cropH - sampleSize, Math.floor(cropH * ry)));
    let alphaFail = 0;
    let total = 0;
    let distSum = 0;
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    const pixels: [number, number, number][] = [];

    for (let py = 0; py < sampleSize; py += 2) {
      for (let px = 0; px < sampleSize; px += 2) {
        const fx = minX + sx + px;
        const fy = minY + sy + py;
        const idx = (fy * fullW + fx) * 4;
        total++;
        if (fullData[idx + 3] < 210) {
          alphaFail++;
          continue;
        }
        const r = fullData[idx];
        const g = fullData[idx + 1];
        const b = fullData[idx + 2];
        rSum += r;
        gSum += g;
        bSum += b;
        distSum += colorDist(r, g, b, domR, domG, domB);
        pixels.push([r, g, b]);
      }
    }

    if (alphaFail > total * 0.05 || pixels.length < 16) continue;
    const avgR = rSum / pixels.length;
    const avgG = gSum / pixels.length;
    const avgB = bSum / pixels.length;
    let localVar = 0;
    for (const [r, g, b] of pixels) {
      localVar += colorDist(r, g, b, avgR, avgG, avgB);
    }
    localVar /= pixels.length;
    const score = (distSum / pixels.length) * 0.8 + localVar * 1.4;
    if (score < bestScore) {
      bestScore = score;
      bestRect = { sx, sy };
    }
  }

  if (bestScore < Number.POSITIVE_INFINITY) {
    const half = patchSize / 2;
    const hiSx = (bestRect.sx / cropW) * hiCropped.width;
    const hiSy = (bestRect.sy / cropH) * hiCropped.height;
    const hiSw = Math.max(8, (sampleSize / cropW) * hiCropped.width);
    const hiSh = Math.max(8, (sampleSize / cropH) * hiCropped.height);

    oCtx.save();
    oCtx.globalAlpha = 0.92;
    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 2; tx++) {
        oCtx.save();
        oCtx.translate(
          tx * half + (tx % 2 === 1 ? half : 0),
          ty * half + (ty % 2 === 1 ? half : 0)
        );
        oCtx.scale(tx % 2 === 1 ? -1 : 1, ty % 2 === 1 ? -1 : 1);
        oCtx.drawImage(
          hiCropped,
          hiSx,
          hiSy,
          hiSw,
          hiSh,
          0,
          0,
          half,
          half
        );
        oCtx.restore();
      }
    }
    oCtx.restore();
  }

  return out;
}

function drawTiledPattern(
  ctx: CanvasRenderingContext2D,
  patternCanvas: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha = 1,
  patternScale = 1
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const pattern = ctx.createPattern(patternCanvas, "repeat");
  if (pattern) {
    if (patternScale !== 1 && typeof DOMMatrix !== "undefined" && typeof pattern.setTransform === "function") {
      pattern.setTransform(new DOMMatrix().scale(patternScale, patternScale));
    }
    ctx.fillStyle = pattern;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

function drawPlacedInBox(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  box: { x: number; y: number; w: number; h: number },
  scale: number,
  offsetX: number,
  offsetY: number,
  mode: GarmentMapping["projectionMode"],
  srcCrop?: { sx: number; sy: number; sw: number; sh: number }
) {
  const sx = srcCrop?.sx ?? 0;
  const sy = srcCrop?.sy ?? 0;
  const sw = srcCrop?.sw ?? src.width;
  const sh = srcCrop?.sh ?? src.height;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();

  if (mode === "chest-graphic") {
    const aspect = sw / Math.max(1, sh);
    const maxW = box.w * 0.54 * scale;
    const maxH = box.h * 0.42 * scale;
    let drawW = maxW;
    let drawH = drawW / aspect;
    if (drawH > maxH) {
      drawH = maxH;
      drawW = drawH * aspect;
    }
    const dx = box.x + (box.w - drawW) / 2 + offsetX * box.w;
    const dy = box.y + box.h * 0.16 + (maxH - drawH) / 2 + offsetY * box.h;
    ctx.drawImage(src, sx, sy, sw, sh, dx, dy, drawW, drawH);
  } else {
    const drawW = box.w * scale;
    const drawH = box.h * scale;
    const dx = box.x + (box.w - drawW) / 2 + offsetX * box.w;
    const dy = box.y + (box.h - drawH) / 2 + offsetY * box.h;
    ctx.drawImage(src, sx, sy, sw, sh, dx, dy, drawW, drawH);
  }

  ctx.restore();
}

function paintPresetAtlas(product: CatalogProduct, canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  const scale = canvas.width / 1024;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const kind = product.presetKind;

  const baseColors: Record<string, string> = {
    "graphic-tee": "#DDD9D0",
    "charcoal-knit": "#272A2F",
    "acid-hoodie": "#363A40",
    "raw-jacket": "#1E2126",
    "light-denim": "#7F93A9",
    "parachute-cargo": "#1D2025",
    "washed-denim": "#2C3036",
    "utility-shorts": "#4A554E",
    custom: product.mapping.baseColorHex || "#D8D4CC",
  };

  const base = baseColors[kind] ?? "#343940";
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 1024, 1024);

  if (product.category === "top") {
    if (kind === "graphic-tee") {
      // Fine combed cotton jersey weave + crisp minimalist front emblem & subtle back typography
      ctx.fillStyle = "rgba(0,0,0,0.025)";
      for (let y = 0; y < 1024; y += 5) ctx.fillRect(0, y, 1024, 1);

      ctx.strokeStyle = "#1E2228";
      ctx.lineWidth = 2.5;
      ctx.strokeRect(TOP_UV.front.x + 124, TOP_UV.front.y + 160, 172, 46);
      ctx.fillStyle = "#1E2228";
      ctx.font = "500 22px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText("MERIDIAN", TOP_UV.front.x + 210, TOP_UV.front.y + 190);

      ctx.fillStyle = "rgba(30,34,40,0.6)";
      ctx.font = "500 13px Georgia, serif";
      ctx.fillText("MERIDIAN · JAKARTA", TOP_UV.back.x + 202, TOP_UV.back.y + 125);
    } else if (kind === "charcoal-knit" || product.cut === "knit") {
      for (let y = 0; y < 1024; y += 7) {
        ctx.fillStyle = y % 14 === 0 ? "rgba(255,255,255,0.045)" : "rgba(0,0,0,0.12)";
        ctx.fillRect(0, y, 1024, 3);
      }
      for (let x = 0; x < 1024; x += 9) {
        ctx.fillStyle = "rgba(0,0,0,0.08)";
        ctx.fillRect(x, 0, 2, 1024);
      }
      ctx.fillStyle = "rgba(210,218,226,0.11)";
      ctx.fillRect(TOP_UV.front.x + 74, TOP_UV.front.y + 180, 76, 8);
      ctx.fillRect(TOP_UV.front.x + 230, TOP_UV.front.y + 365, 88, 7);
    } else if (kind === "acid-hoodie" || product.cut === "hoodie") {
      for (let i = 0; i < 110; i++) {
        const cx = (i * 97) % 1024;
        const cy = (i * 151) % 1024;
        const rad = 28 + (i % 5) * 20;
        const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, rad);
        grad.addColorStop(
          0,
          i % 2 === 0 ? "rgba(215,222,232,0.11)" : "rgba(10,12,16,0.16)"
        );
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
      }
      ctx.strokeStyle = "rgba(232,236,242,0.45)";
      ctx.lineWidth = 2;
      ctx.strokeRect(TOP_UV.front.x + 128, TOP_UV.front.y + 165, 164, 34);
      ctx.fillStyle = "rgba(236,240,245,0.78)";
      ctx.font = "500 18px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText("STUDIO NOIR", TOP_UV.front.x + 210, TOP_UV.front.y + 188);

      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 2;
      ctx.strokeRect(TOP_UV.front.x + 92, TOP_UV.front.y + 345, 236, 130);
    } else if (kind === "raw-jacket" || product.cut === "jacket") {
      ctx.strokeStyle = "rgba(255,255,255,0.035)";
      ctx.lineWidth = 1;
      for (let y = -1024; y < 1024; y += 6) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(1024, y + 360);
        ctx.stroke();
      }
      const midX = TOP_UV.front.x + TOP_UV.front.w * 0.5;
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(midX, TOP_UV.front.y + 120);
      ctx.lineTo(midX, TOP_UV.front.y + TOP_UV.front.h - 10);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      ctx.arc(midX - 10, TOP_UV.front.y + 260, 5, 0, Math.PI * 2);
      ctx.arc(midX - 10, TOP_UV.front.y + 335, 5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = "rgba(0,0,0,0.05)";
      ctx.lineWidth = 1;
      for (let y = 0; y < 1024; y += 8) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(1024, y);
        ctx.stroke();
      }
    }
    return;
  }

  // Bottom presets
  if (kind === "light-denim" || kind === "washed-denim") {
    ctx.strokeStyle =
      kind === "light-denim" ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.055)";
    ctx.lineWidth = 1;
    for (let y = -1024; y < 1024; y += 5) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1024, y + 420);
      ctx.stroke();
    }
    for (const panel of [BOTTOM_UV.frontLeftLeg, BOTTOM_UV.frontRightLeg]) {
      const grad = ctx.createRadialGradient(
        panel.x + panel.w * 0.5,
        panel.y + panel.h * 0.36,
        14,
        panel.x + panel.w * 0.5,
        panel.y + panel.h * 0.36,
        panel.w * 0.72
      );
      grad.addColorStop(
        0,
        kind === "light-denim" ? "rgba(232,240,248,0.24)" : "rgba(180,192,208,0.12)"
      );
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    }
    ctx.strokeStyle =
      kind === "light-denim" ? "rgba(240,235,220,0.45)" : "rgba(180,188,198,0.22)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    for (const panel of [BOTTOM_UV.backLeftLeg, BOTTOM_UV.backRightLeg]) {
      ctx.strokeRect(panel.x + 62, panel.y + 68, 108, 114);
    }
    ctx.setLineDash([]);
  } else if (kind === "parachute-cargo" || product.cut === "cargo") {
    ctx.strokeStyle = "rgba(255,255,255,0.045)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 1024; i += 10) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 1024);
      ctx.moveTo(0, i);
      ctx.lineTo(1024, i);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 2;
    for (const panel of [BOTTOM_UV.frontLeftLeg, BOTTOM_UV.frontRightLeg]) {
      ctx.strokeRect(panel.x + 28, panel.y + 235, 110, 145);
      ctx.beginPath();
      ctx.moveTo(panel.x + 24, panel.y + 455);
      ctx.lineTo(panel.x + panel.w - 24, panel.y + 455);
      ctx.stroke();
    }
  } else {
    // Twill weave + welt pockets for utility shorts / trousers
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let y = -1024; y < 1024; y += 6) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1024, y + 320);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 2;
    for (const panel of [BOTTOM_UV.backLeftLeg, BOTTOM_UV.backRightLeg]) {
      ctx.strokeRect(panel.x + 58, panel.y + 74, 112, 24);
    }
  }
}

/**
 * Generates clean 480x480 studio 2D flat-lay garment silhouettes for the marketplace cards
 * and 2D photo viewer (Front and Back views).
 */
function render2DStudioFlat(
  product: CatalogProduct,
  atlasCanvas: HTMLCanvasElement,
  side: "front" | "back",
  uploadedCutout: HTMLCanvasElement | null
): string {
  const outSize = 320;
  const size = 480;
  const out = createCanvas(outSize, outSize);
  const ctx = out.getContext("2d")!;
  const outScale = outSize / size;
  ctx.setTransform(outScale, 0, 0, outScale, 0, 0);
  const atlasScale = atlasCanvas.width / 1024;

  const bg = ctx.createLinearGradient(0, 0, 0, size);
  bg.addColorStop(0, "#F4F2ED");
  bg.addColorStop(1, "#EAE7E0");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  if (uploadedCutout) {
    const pad = 42;
    const ratio = Math.min(
      (size - pad * 2) / uploadedCutout.width,
      (size - pad * 2) / uploadedCutout.height
    );
    const dw = uploadedCutout.width * ratio;
    const dh = uploadedCutout.height * ratio;
    ctx.save();
    ctx.shadowColor = "rgba(15, 23, 42, 0.14)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 10;
    ctx.drawImage(uploadedCutout, (size - dw) / 2, (size - dh) / 2, dw, dh);
    ctx.restore();
    return out.toDataURL("image/jpeg", 0.82);
  }

  ctx.save();
  ctx.shadowColor = "rgba(15, 23, 42, 0.16)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 12;

  const path = new Path2D();
  if (product.category === "top") {
    const isShort = product.cut === "tee";
    if (isShort) {
      path.moveTo(186, 68);
      path.quadraticCurveTo(240, side === "front" ? 104 : 82, 294, 68);
      path.lineTo(356, 86);
      path.lineTo(426, 178);
      path.lineTo(368, 220);
      path.lineTo(338, 174);
      path.lineTo(338, 412);
      path.lineTo(142, 412);
      path.lineTo(142, 174);
      path.lineTo(112, 220);
      path.lineTo(54, 178);
      path.lineTo(124, 86);
      path.closePath();
    } else {
      path.moveTo(188, 62);
      path.quadraticCurveTo(240, side === "front" ? 96 : 76, 292, 62);
      path.lineTo(352, 82);
      path.lineTo(422, 366);
      path.lineTo(366, 378);
      path.lineTo(334, 194);
      path.lineTo(334, 416);
      path.lineTo(146, 416);
      path.lineTo(146, 194);
      path.lineTo(114, 378);
      path.lineTo(58, 366);
      path.lineTo(128, 82);
      path.closePath();
    }
  } else {
    const isShorts = product.cut === "shorts";
    const hemY = isShorts ? 310 : 428;
    const legOut = isShorts ? 344 : 334;
    const legIn = isShorts ? 250 : 254;
    path.moveTo(146, 62);
    path.lineTo(334, 62);
    path.lineTo(legOut, hemY);
    path.lineTo(legIn, hemY);
    path.lineTo(240, 186);
    path.lineTo(480 - legIn, hemY);
    path.lineTo(480 - legOut, hemY);
    path.closePath();
  }

  ctx.fillStyle = "#2A2F36";
  ctx.fill(path);
  ctx.restore();

  ctx.save();
  ctx.clip(path);
  if (product.category === "top") {
    const box = side === "front" ? TOP_UV.front : TOP_UV.back;
    const sleeveH = product.cut === "tee" ? 210 : TOP_UV.rightSleeve.h;
    ctx.drawImage(
      atlasCanvas,
      TOP_UV.rightSleeve.x * atlasScale,
      TOP_UV.rightSleeve.y * atlasScale,
      TOP_UV.rightSleeve.w * atlasScale,
      sleeveH * atlasScale,
      44,
      62,
      150,
      340
    );
    ctx.drawImage(
      atlasCanvas,
      TOP_UV.leftSleeve.x * atlasScale,
      TOP_UV.leftSleeve.y * atlasScale,
      TOP_UV.leftSleeve.w * atlasScale,
      sleeveH * atlasScale,
      286,
      62,
      150,
      340
    );
    ctx.drawImage(
      atlasCanvas,
      box.x * atlasScale,
      box.y * atlasScale,
      box.w * atlasScale,
      box.h * atlasScale,
      132,
      60,
      216,
      360
    );
  } else {
    const leftBox = side === "front" ? BOTTOM_UV.frontLeftLeg : BOTTOM_UV.backLeftLeg;
    const rightBox = side === "front" ? BOTTOM_UV.frontRightLeg : BOTTOM_UV.backRightLeg;
    const srcH = product.cut === "shorts" ? 390 : leftBox.h;
    const dstH = product.cut === "shorts" ? 255 : 370;
    ctx.drawImage(
      atlasCanvas,
      leftBox.x * atlasScale,
      leftBox.y * atlasScale,
      leftBox.w * atlasScale,
      srcH * atlasScale,
      130,
      62,
      112,
      dstH
    );
    ctx.drawImage(
      atlasCanvas,
      rightBox.x * atlasScale,
      rightBox.y * atlasScale,
      rightBox.w * atlasScale,
      srcH * atlasScale,
      238,
      62,
      112,
      dstH
    );
  }

  const shade = ctx.createLinearGradient(60, 0, 420, 0);
  shade.addColorStop(0, "rgba(0,0,0,0.14)");
  shade.addColorStop(0.25, "rgba(255,255,255,0.04)");
  shade.addColorStop(0.5, "rgba(255,255,255,0.07)");
  shade.addColorStop(0.75, "rgba(0,0,0,0.03)");
  shade.addColorStop(1, "rgba(0,0,0,0.16)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  ctx.strokeStyle = "rgba(15, 23, 42, 0.14)";
  ctx.lineWidth = 1.5;
  ctx.stroke(path);

  return out.toDataURL("image/jpeg", 0.82);
}

const TEXTURE_CACHE = new Map<string, Promise<BuiltGarmentTextures>>();
const RESOLVED_CACHE = new Map<string, BuiltGarmentTextures>();

function getMaxTextureCache(): number {
  return isConstrainedDevice() ? 8 : 14;
}

function getCacheKey(product: CatalogProduct): string {
  const m = product.mapping;
  return [
    product.category,
    product.cut,
    product.presetKind,
    m.frontImageUrl ?? "",
    m.backImageUrl ?? "",
    m.sleeveImageUrl ?? "",
    m.projectionMode,
    m.scale,
    m.offsetX,
    m.offsetY,
    m.backScale,
    m.backOffsetY,
    m.autoRemoveBackground,
    m.baseColorHex,
  ].join("|");
}

export function getCachedGarmentTextures(
  product: CatalogProduct
): BuiltGarmentTextures | null {
  const key = getCacheKey(product);
  const hit = RESOLVED_CACHE.get(key);
  if (!hit) return null;
  RESOLVED_CACHE.delete(key);
  RESOLVED_CACHE.set(key, hit);
  return hit;
}

export function buildGarmentTextures(
  product: CatalogProduct
): Promise<BuiltGarmentTextures> {
  const key = getCacheKey(product);
  const hit = TEXTURE_CACHE.get(key);
  if (hit) {
    // Refresh LRU order so active products stay cached
    TEXTURE_CACHE.delete(key);
    TEXTURE_CACHE.set(key, hit);
    return hit;
  }

  const promise = buildGarmentTexturesUncached(product)
    .then((built) => {
      const maxResolved = getMaxTextureCache();
      while (RESOLVED_CACHE.size >= maxResolved) {
        const oldest = RESOLVED_CACHE.keys().next().value;
        if (!oldest) break;
        RESOLVED_CACHE.delete(oldest);
      }
      RESOLVED_CACHE.set(key, built);
      return built;
    })
    .catch((err) => {
      TEXTURE_CACHE.delete(key);
      RESOLVED_CACHE.delete(key);
      throw err;
    });

  const maxCache = getMaxTextureCache();
  while (TEXTURE_CACHE.size >= maxCache) {
    const oldest = TEXTURE_CACHE.keys().next().value;
    if (!oldest) break;
    TEXTURE_CACHE.delete(oldest);
    RESOLVED_CACHE.delete(oldest);
  }
  TEXTURE_CACHE.set(key, promise);
  return promise;
}

export function isValidGarmentImageUrl(
  url: string | null | undefined
): url is string {
  if (!url) return false;
  const trimmed = url.trim();
  return (
    trimmed.startsWith("/") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:image/") ||
    trimmed.startsWith("blob:")
  );
}

async function buildGarmentTexturesUncached(
  product: CatalogProduct
): Promise<BuiltGarmentTextures> {
  const constrained = isConstrainedDevice();
  // Power-of-two 1024x1024 atlas matches native 450px torso texels 1:1 with 4x faster GPU upload
  const atlasSize = 1024;
  const atlasCanvas = createCanvas(atlasSize, atlasSize);
  const { mapping } = product;

  const frontUrl = isValidGarmentImageUrl(mapping.frontImageUrl)
    ? mapping.frontImageUrl.trim()
    : null;
  const backUrl = isValidGarmentImageUrl(mapping.backImageUrl)
    ? mapping.backImageUrl.trim()
    : null;
  const sleeveUrl = isValidGarmentImageUrl(mapping.sleeveImageUrl)
    ? mapping.sleeveImageUrl.trim()
    : null;

  if (!frontUrl && !backUrl) {
    paintPresetAtlas(product, atlasCanvas);
    return {
      atlasCanvas,
      extractedHex: mapping.baseColorHex,
      front2dDataUrl: render2DStudioFlat(product, atlasCanvas, "front", null),
      back2dDataUrl: render2DStudioFlat(product, atlasCanvas, "back", null),
      mappingSummary: mapping.detectedFabricLabel,
    };
  }

  const aCtx = atlasCanvas.getContext("2d")!;
  const atlasScale = atlasSize / 1024;
  aCtx.setTransform(atlasScale, 0, 0, atlasScale, 0, 0);
  aCtx.imageSmoothingEnabled = true;
  aCtx.imageSmoothingQuality = "high";

  const tryLoadCutout = async (url: string | null): Promise<CutoutResult | null> => {
    if (!url) return null;
    try {
      const img = await loadImage(url);
      return analyzeAndIsolateGarment(img, mapping.autoRemoveBackground, constrained);
    } catch {
      return null;
    }
  };

  // Load front, back, and sleeve packshots in parallel instead of sequentially
  const [frontCutout, backCutout, sleeveCutout] = await Promise.all([
    tryLoadCutout(frontUrl),
    tryLoadCutout(backUrl),
    tryLoadCutout(sleeveUrl),
  ]);

  const primary = frontCutout ?? backCutout ?? sleeveCutout;
  if (!primary) {
    paintPresetAtlas(product, atlasCanvas);
    return {
      atlasCanvas,
      extractedHex: mapping.baseColorHex,
      front2dDataUrl: render2DStudioFlat(product, atlasCanvas, "front", null),
      back2dDataUrl: render2DStudioFlat(product, atlasCanvas, "back", null),
      mappingSummary: mapping.detectedFabricLabel,
    };
  }

  const baseHex = primary.dominantHex || mapping.baseColorHex;

  aCtx.fillStyle = baseHex;
  aCtx.fillRect(0, 0, 1024, 1024);
  drawTiledPattern(aCtx, primary.patchCanvas, 0, 0, 1024, 1024, 0.96, 1 / atlasScale);

  if (mapping.projectionMode === "all-over-pattern" && frontCutout) {
    const tileSize = constrained ? 256 : 512;
    const tile = createCanvas(tileSize, tileSize);
    const tCtx = tile.getContext("2d")!;
    tCtx.imageSmoothingEnabled = true;
    tCtx.imageSmoothingQuality = "high";
    tCtx.drawImage(frontCutout.canvas, 0, 0, tileSize, tileSize);
    drawTiledPattern(aCtx, tile, 0, 0, 1024, 1024, 1, 256 / tileSize);
  } else if (product.category === "top") {
    if (frontCutout) {
      const cw = frontCutout.canvas.width;
      const ch = frontCutout.canvas.height;
      const isFlatLayWithSleeves =
        mapping.projectionMode === "auto-garment" && cw / Math.max(1, ch) > 0.92;
      const torsoCrop = isFlatLayWithSleeves
        ? {
            sx: Math.round(cw * 0.21),
            sy: Math.round(ch * 0.03),
            sw: Math.round(cw * 0.58),
            sh: Math.round(ch * 0.93),
          }
        : undefined;
      drawPlacedInBox(
        aCtx,
        frontCutout.canvas,
        TOP_UV.front,
        mapping.scale,
        mapping.offsetX,
        mapping.offsetY,
        mapping.projectionMode,
        torsoCrop
      );
    }
    if (backCutout) {
      const cw = backCutout.canvas.width;
      const ch = backCutout.canvas.height;
      const isFlatLayWithSleeves =
        mapping.projectionMode === "auto-garment" && cw / Math.max(1, ch) > 0.92;
      const torsoCrop = isFlatLayWithSleeves
        ? {
            sx: Math.round(cw * 0.21),
            sy: Math.round(ch * 0.03),
            sw: Math.round(cw * 0.58),
            sh: Math.round(ch * 0.93),
          }
        : undefined;
      drawPlacedInBox(
        aCtx,
        backCutout.canvas,
        TOP_UV.back,
        mapping.backScale,
        0,
        mapping.backOffsetY,
        mapping.projectionMode,
        torsoCrop
      );
    }
    if (sleeveCutout) {
      drawPlacedInBox(aCtx, sleeveCutout.canvas, TOP_UV.leftSleeve, 1, 0, 0, "auto-garment");
      drawPlacedInBox(aCtx, sleeveCutout.canvas, TOP_UV.rightSleeve, 1, 0, 0, "auto-garment");
    }
  } else {
    if (frontCutout) {
      const halfW = frontCutout.canvas.width / 2;
      const fullH = frontCutout.canvas.height;
      drawPlacedInBox(
        aCtx,
        frontCutout.canvas,
        BOTTOM_UV.frontLeftLeg,
        mapping.scale,
        mapping.offsetX,
        mapping.offsetY,
        mapping.projectionMode,
        { sx: 0, sy: 0, sw: halfW, sh: fullH }
      );
      drawPlacedInBox(
        aCtx,
        frontCutout.canvas,
        BOTTOM_UV.frontRightLeg,
        mapping.scale,
        mapping.offsetX,
        mapping.offsetY,
        mapping.projectionMode,
        { sx: halfW, sy: 0, sw: halfW, sh: fullH }
      );
      drawPlacedInBox(
        aCtx,
        frontCutout.canvas,
        BOTTOM_UV.waistband,
        1,
        0,
        0,
        "auto-garment",
        { sx: 0, sy: 0, sw: frontCutout.canvas.width, sh: Math.max(16, fullH * 0.14) }
      );
    }
    if (backCutout) {
      const halfW = backCutout.canvas.width / 2;
      const fullH = backCutout.canvas.height;
      drawPlacedInBox(
        aCtx,
        backCutout.canvas,
        BOTTOM_UV.backLeftLeg,
        mapping.backScale,
        0,
        mapping.backOffsetY,
        mapping.projectionMode,
        { sx: 0, sy: 0, sw: halfW, sh: fullH }
      );
      drawPlacedInBox(
        aCtx,
        backCutout.canvas,
        BOTTOM_UV.backRightLeg,
        mapping.backScale,
        0,
        mapping.backOffsetY,
        mapping.projectionMode,
        { sx: halfW, sy: 0, sw: halfW, sh: fullH }
      );
    }
    if (sleeveCutout) {
      drawTiledPattern(
        aCtx,
        sleeveCutout.patchCanvas,
        BOTTOM_UV.waistband.x,
        BOTTOM_UV.waistband.y,
        BOTTOM_UV.waistband.w,
        BOTTOM_UV.waistband.h,
        0.9,
        1 / atlasScale
      );
    }
  }

  let mappingSummary = "BACK AUTO-MATCHED FROM FRONT FABRIC";
  if (backCutout) {
    mappingSummary = sleeveCutout
      ? "MULTI-VIEW MAPPED (FRONT + BACK + SLEEVE)"
      : "FRONT + BACK DESIGN MAPPED";
  } else if (sleeveCutout) {
    mappingSummary = "FRONT + SLEEVE MAPPED, BACK AUTO-MATCHED";
  }

  return {
    atlasCanvas,
    extractedHex: baseHex,
    front2dDataUrl:
      frontUrl ??
      render2DStudioFlat(
        product,
        atlasCanvas,
        "front",
        frontCutout ? frontCutout.canvas : null
      ),
    back2dDataUrl:
      backUrl ??
      render2DStudioFlat(
        product,
        atlasCanvas,
        "back",
        backCutout ? backCutout.canvas : null
      ),
    mappingSummary,
  };
}
