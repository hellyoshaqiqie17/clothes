"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { loadGarmentGlbBuffer } from "@/lib/garmentGlbLoader";
import {
  buildGarmentTextures,
  getCachedGarmentTextures,
  type BuiltGarmentTextures,
} from "@/lib/garmentTextureBuilder";
import type {
  CatalogProduct,
  ProductPreviews,
  ViewerAngle,
} from "@/types/catalog";

interface GarmentViewer3DProps {
  product: CatalogProduct;
  anglePreset?: ViewerAngle;
  paused?: boolean;
  enableZoom?: boolean;
  preloadProducts?: CatalogProduct[];
  onPreviewsBuilt?: (productId: string, previews: ProductPreviews) => void;
  onReady?: () => void;
}

interface RenderProfile {
  constrained: boolean;
  pixelRatio: number;
  antialias: boolean;
  anisotropy: number;
}

function getRenderProfile(): RenderProfile {
  const dpr = window.devicePixelRatio || 1;
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
  const constrained = veryLowMem || (narrowOrTouch && (lowMem || lowCores));

  return {
    constrained,
    pixelRatio: constrained ? Math.min(dpr, 1.25) : Math.min(dpr, 1.5),
    antialias: true,
    anisotropy: constrained ? 4 : 8,
  };
}

function parseGlbIsolated(buffer: ArrayBuffer): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    // Copy slice so GLTFLoader never mutates or detaches the shared cached ArrayBuffer
    loader.parse(
      buffer.slice(0),
      "",
      (gltf) => resolve(gltf.scene),
      (err) => reject(err)
    );
  });
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 4, half, half, half);
  grad.addColorStop(0, "rgba(24, 24, 23, 0.14)");
  grad.addColorStop(0.45, "rgba(24, 24, 23, 0.06)");
  grad.addColorStop(0.78, "rgba(24, 24, 23, 0.015)");
  grad.addColorStop(1, "rgba(24, 24, 23, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/**
 * Fallback procedural 3D garment rig used ONLY if both static and API GLB loads
 * fail (e.g. completely offline before cache warms). Guarantees 3D always renders.
 */
function buildProceduralGarmentFallback(): {
  root: THREE.Group;
  topLongMesh: THREE.Mesh;
  topTeeMesh: THREE.Mesh;
  bottomFullMesh: THREE.Mesh;
  bottomShortsMesh: THREE.Mesh;
  topMat: THREE.MeshStandardMaterial;
  bottomMat: THREE.MeshStandardMaterial;
} {
  const root = new THREE.Group();

  const topMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  const topGeo = new THREE.CylinderGeometry(0.19, 0.21, 0.56, 28, 8, true);
  topGeo.scale(1.0, 1.0, 0.58);
  topGeo.translate(0, 1.22, 0);
  const topLongMesh = new THREE.Mesh(topGeo, topMat);
  topLongMesh.name = "outfit_top_long";
  root.add(topLongMesh);

  const bottomMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  const bottomGeo = new THREE.CylinderGeometry(0.16, 0.14, 0.92, 28, 8, true);
  bottomGeo.scale(1.05, 1.0, 0.65);
  bottomGeo.translate(0, 0.56, 0);
  const bottomFullMesh = new THREE.Mesh(bottomGeo, bottomMat);
  bottomFullMesh.name = "outfit_bottom_full";
  root.add(bottomFullMesh);

  return {
    root,
    topLongMesh,
    topTeeMesh: topLongMesh,
    bottomFullMesh,
    bottomShortsMesh: bottomFullMesh,
    topMat,
    bottomMat,
  };
}

function getGarmentFraming(
  category: CatalogProduct["category"],
  cut: CatalogProduct["cut"]
): {
  offsetY: number;
  centerY: number;
  baseDist: number;
  shadowScaleX: number;
  shadowScaleZ: number;
} {
  if (category === "top") {
    return {
      offsetY: -0.82,
      centerY: 0.41,
      baseDist: cut === "tee" ? 1.26 : 1.44,
      shadowScaleX: cut === "tee" ? 0.72 : 0.88,
      shadowScaleZ: 0.54,
    };
  }
  if (cut === "shorts") {
    return {
      offsetY: -0.44,
      centerY: 0.35,
      baseDist: 1.26,
      shadowScaleX: 0.62,
      shadowScaleZ: 0.46,
    };
  }
  return {
    offsetY: 0.0,
    centerY: 0.57,
    baseDist: 2.24,
    shadowScaleX: 0.66,
    shadowScaleZ: 0.48,
  };
}

function getCameraGoal(
  category: CatalogProduct["category"],
  cut: CatalogProduct["cut"],
  angle: ViewerAngle
): { pos: THREE.Vector3; target: THREE.Vector3 } {
  const { centerY, baseDist } = getGarmentFraming(category, cut);
  let azimuth = 0;
  if (angle === "three-quarter") azimuth = 0.56;
  else if (angle === "side") azimuth = Math.PI * 0.5;
  else if (angle === "back") azimuth = Math.PI;

  const target = new THREE.Vector3(0, centerY, 0);
  const pos = new THREE.Vector3(
    Math.sin(azimuth) * baseDist,
    centerY + 0.06,
    Math.cos(azimuth) * baseDist
  );
  return { pos, target };
}

function getProductSignature(product: CatalogProduct): string {
  const m = product.mapping;
  return [
    product.id,
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

function getFabricSurface(product: CatalogProduct): {
  roughness: number;
  normalScale: number;
} {
  if (product.cut === "knit") return { roughness: 0.93, normalScale: 0.92 };
  if (product.cut === "hoodie") return { roughness: 0.92, normalScale: 0.72 };
  if (product.cut === "jacket") return { roughness: 0.82, normalScale: 0.58 };
  if (product.cut === "cargo") return { roughness: 0.78, normalScale: 0.72 };
  if (product.cut === "tee") return { roughness: 0.9, normalScale: 0.42 };
  return { roughness: 0.87, normalScale: 0.76 };
}

function attachInteriorLiningShader(mat: THREE.MeshStandardMaterial) {
  const innerUniform = { value: new THREE.Color("#C9C5BC") };
  mat.userData.innerFabricColor = innerUniform;
  mat.customProgramCacheKey = () => "meridian-garment-inner-v1";
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uInnerFabricColor = innerUniform;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uInnerFabricColor;"
      )
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\nif ( !gl_FrontFacing ) { diffuseColor.rgb = uInnerFabricColor; }"
      );
  };
}

function updateInteriorLiningColor(mat: THREE.MeshStandardMaterial, hex: string) {
  const uniform = mat.userData.innerFabricColor as
    | { value: THREE.Color }
    | undefined;
  if (!uniform) return;
  uniform.value.set(hex || "#D8D4CC").multiplyScalar(0.84);
}

function makeSolidFallbackTexture(hex: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = hex || "#D8D4CC";
    ctx.fillRect(0, 0, 32, 32);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  return tex;
}

export default function GarmentViewer3D({
  product,
  anglePreset = "three-quarter",
  paused = false,
  enableZoom = true,
  preloadProducts,
  onPreviewsBuilt,
  onReady,
}: GarmentViewer3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const [rigReadySeq, setRigReadySeq] = useState(0);
  const readyNotifiedRef = useRef(false);

  const onPreviewsBuiltRef = useRef(onPreviewsBuilt);
  useEffect(() => {
    onPreviewsBuiltRef.current = onPreviewsBuilt;
  }, [onPreviewsBuilt]);

  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  const productRef = useRef(product);
  useEffect(() => {
    productRef.current = product;
  }, [product]);

  const pausedRef = useRef(paused);

  const ctxRef = useRef<{
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    holder: THREE.Group;
    shadowPlane: THREE.Mesh;
    topLongMesh: THREE.Mesh | null;
    topTeeMesh: THREE.Mesh | null;
    bottomFullMesh: THREE.Mesh | null;
    bottomShortsMesh: THREE.Mesh | null;
    topMat: THREE.MeshStandardMaterial | null;
    bottomMat: THREE.MeshStandardMaterial | null;
    texPool: Map<
      string,
      { tex: THREE.CanvasTexture; built: BuiltGarmentTextures }
    >;
    fallbackTex: THREE.CanvasTexture | null;
    anisotropy: number;
    appliedSignature: string;
    goalPos: THREE.Vector3;
    goalTarget: THREE.Vector3;
    transitioning: boolean;
    reducedMotion: boolean;
    requestRender: () => void;
    cancelRender: () => void;
  } | null>(null);

  useEffect(() => {
    pausedRef.current = paused;
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (paused) {
      ctx.cancelRender();
    } else {
      ctx.requestRender();
    }
  }, [paused]);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.controls.enableZoom = enableZoom;
  }, [enableZoom]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const profile = getRenderProfile();
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    let disposed = false;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: profile.antialias,
        alpha: true,
        depth: true,
        stencil: false,
        powerPreference: "default",
      });
    } catch {
      queueMicrotask(() => {
        setWebglUnavailable(true);
        if (!readyNotifiedRef.current) {
          readyNotifiedRef.current = true;
          onReadyRef.current?.();
        }
      });
      return;
    }

    renderer.setPixelRatio(profile.pixelRatio);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.shadowMap.enabled = false;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const anisotropy = Math.min(profile.anisotropy, Math.max(1, maxAniso));

    const scene = new THREE.Scene();

    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    const camera = new THREE.PerspectiveCamera(34, w / h, 0.05, 24);
    const initialGoal = getCameraGoal(
      productRef.current.category,
      productRef.current.cut,
      anglePreset
    );
    camera.position.copy(initialGoal.pos);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(initialGoal.target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.11;
    controls.rotateSpeed = 0.88;
    controls.enablePan = false;
    controls.enableZoom = enableZoom;
    controls.minDistance = 0.55;
    controls.maxDistance = 3.0;
    controls.minPolarAngle = 0.25;
    controls.maxPolarAngle = Math.PI * 0.65;

    // Lightweight 5-light studio rig tuned for matte cloth over pure white (zero PMREM freeze)
    const hemi = new THREE.HemisphereLight(0xffffff, 0xc8cfd8, 1.12);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfffaf2, 1.46);
    key.position.set(2.2, 3.1, 2.5);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xdce6f2, 0.56);
    fill.position.set(-2.4, 1.7, 1.8);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xeef2f7, 0.72);
    rim.position.set(0.0, 2.2, -2.8);
    scene.add(rim);

    const bounce = new THREE.DirectionalLight(0xf6f5f2, 0.26);
    bounce.position.set(0.0, -1.6, 1.4);
    scene.add(bounce);

    // Zero-cost soft radial contact shadow (eliminates second depth pass + PCF shadow map)
    const shadowTex = createContactShadowTexture();
    const shadowGeom = new THREE.PlaneGeometry(1, 1);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
    });
    const shadowPlane = new THREE.Mesh(shadowGeom, shadowMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = 0.01;
    scene.add(shadowPlane);

    const holder = new THREE.Group();
    scene.add(holder);

    let rafId = 0;
    let isVisible = true;
    let tabHidden = document.hidden;
    let interacting = false;
    let slowDragStreak = 0;
    let dragScaledDown = false;
    let settleFrames = 0;
    let lastTime = performance.now();
    const prevPos = new THREE.Vector3();
    const prevTarget = new THREE.Vector3();

    const canRender = () => !disposed && isVisible && !tabHidden && !pausedRef.current;

    const cancelRender = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    const renderFrame = (now: number) => {
      rafId = 0;
      if (!canRender()) return;

      const rawDtMs = now - lastTime;
      const dt = Math.min(0.1, Math.max(0.001, rawDtMs / 1000));
      lastTime = now;

      const ctx = ctxRef.current;
      if (!ctx) return;

      // Adaptive resolution guard: if an integrated/mobile GPU struggles during continuous drag,
      // step down DPR to 1.0 while dragging and restore full crisp DPR when drag ends.
      if (interacting && !dragScaledDown && profile.pixelRatio > 1.05) {
        if (rawDtMs > 23 && rawDtMs < 120) {
          slowDragStreak += 1;
          if (slowDragStreak >= 4) {
            dragScaledDown = true;
            renderer.setPixelRatio(1.0);
          }
        } else {
          slowDragStreak = 0;
        }
      }

      if (ctx.transitioning) {
        const factor = ctx.reducedMotion ? 1 : 1 - Math.exp(-10 * dt);
        camera.position.lerp(ctx.goalPos, factor);
        controls.target.lerp(ctx.goalTarget, factor);
        if (
          camera.position.distanceTo(ctx.goalPos) < 0.005 &&
          controls.target.distanceTo(ctx.goalTarget) < 0.005
        ) {
          camera.position.copy(ctx.goalPos);
          controls.target.copy(ctx.goalTarget);
          ctx.transitioning = false;
        }
      }

      prevPos.copy(camera.position);
      prevTarget.copy(controls.target);
      controls.update();
      renderer.render(scene, camera);

      const moved =
        camera.position.distanceToSquared(prevPos) > 1e-8 ||
        controls.target.distanceToSquared(prevTarget) > 1e-8;

      if (ctx.transitioning || interacting || moved) {
        settleFrames = 0;
        rafId = requestAnimationFrame(renderFrame);
      } else if (settleFrames < 2) {
        settleFrames += 1;
        rafId = requestAnimationFrame(renderFrame);
      }
    };

    const requestRender = () => {
      if (!canRender()) return;
      settleFrames = 0;
      if (!rafId) {
        lastTime = performance.now();
        rafId = requestAnimationFrame(renderFrame);
      }
    };

    const onVisibilityChange = () => {
      tabHidden = document.hidden;
      if (tabHidden) cancelRender();
      else requestRender();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      cancelRender();
    };
    const onContextRestored = () => {
      requestRender();
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);

    ctxRef.current = {
      renderer,
      camera,
      controls,
      holder,
      shadowPlane,
      topLongMesh: null,
      topTeeMesh: null,
      bottomFullMesh: null,
      bottomShortsMesh: null,
      topMat: null,
      bottomMat: null,
      texPool: new Map(),
      fallbackTex: null,
      anisotropy,
      appliedSignature: "",
      goalPos: initialGoal.pos.clone(),
      goalTarget: initialGoal.target.clone(),
      transitioning: false,
      reducedMotion,
      requestRender,
      cancelRender,
    };

    const onControlStart = () => {
      interacting = true;
      slowDragStreak = 0;
      if (ctxRef.current) ctxRef.current.transitioning = false;
      requestRender();
    };
    const onControlEnd = () => {
      interacting = false;
      slowDragStreak = 0;
      if (dragScaledDown) {
        dragScaledDown = false;
        renderer.setPixelRatio(profile.pixelRatio);
      }
      requestRender();
    };
    controls.addEventListener("start", onControlStart);
    controls.addEventListener("change", requestRender);
    controls.addEventListener("end", onControlEnd);

    const geometriesToDispose = new Set<THREE.BufferGeometry>();

    const mountGarmentRig = async () => {
      try {
        const buffer = await loadGarmentGlbBuffer();
        if (disposed || !ctxRef.current) return;
        const parsedScene = await parseGlbIsolated(buffer);
        if (disposed || !ctxRef.current) return;

        let topLongMesh: THREE.Mesh | null = null;
        let topTeeMesh: THREE.Mesh | null = null;
        let bottomFullMesh: THREE.Mesh | null = null;
        let bottomShortsMesh: THREE.Mesh | null = null;
        let topMat: THREE.MeshStandardMaterial | null = null;
        let bottomMat: THREE.MeshStandardMaterial | null = null;

        const configureMat = (
          existing: THREE.MeshStandardMaterial | null,
          src: THREE.Material | THREE.Material[]
        ): THREE.MeshStandardMaterial => {
          if (existing) return existing;
          const raw = Array.isArray(src) ? src[0] : src;
          const mat =
            raw instanceof THREE.MeshStandardMaterial
              ? raw
              : new THREE.MeshStandardMaterial({ color: 0xffffff });
          mat.side = THREE.DoubleSide;
          mat.metalness = 0.02;
          if (mat.normalMap) {
            mat.normalMap.anisotropy = anisotropy;
            mat.normalMap.minFilter = THREE.LinearMipmapLinearFilter;
            mat.normalMap.magFilter = THREE.LinearFilter;
          }
          attachInteriorLiningShader(mat);
          return mat;
        };

        parsedScene.traverse((node) => {
          if (!(node instanceof THREE.Mesh)) return;
          geometriesToDispose.add(node.geometry);

          if (node.name === "outfit_top_long" || node.name === "outfit_top") {
            topMat = configureMat(topMat, node.material);
            node.material = topMat;
            topLongMesh = node;
          } else if (node.name === "outfit_top_tee") {
            topMat = configureMat(topMat, node.material);
            node.material = topMat;
            topTeeMesh = node;
          } else if (
            node.name === "outfit_bottom_full" ||
            node.name === "outfit_bottom"
          ) {
            bottomMat = configureMat(bottomMat, node.material);
            node.material = bottomMat;
            bottomFullMesh = node;
          } else if (node.name === "outfit_bottom_shorts") {
            bottomMat = configureMat(bottomMat, node.material);
            node.material = bottomMat;
            bottomShortsMesh = node;
          } else {
            node.visible = false;
          }
        });

        if (!topLongMesh && !bottomFullMesh) {
          throw new Error("Parsed GLB did not contain garment meshes");
        }

        holder.add(parsedScene);

        ctxRef.current.topLongMesh = topLongMesh;
        ctxRef.current.topTeeMesh = topTeeMesh ?? topLongMesh;
        ctxRef.current.bottomFullMesh = bottomFullMesh;
        ctxRef.current.bottomShortsMesh = bottomShortsMesh ?? bottomFullMesh;
        ctxRef.current.topMat = topMat;
        ctxRef.current.bottomMat = bottomMat;

        setRigReadySeq((n) => n + 1);
      } catch {
        if (disposed || !ctxRef.current) return;
        const fallback = buildProceduralGarmentFallback();
        geometriesToDispose.add(fallback.topLongMesh.geometry);
        geometriesToDispose.add(fallback.bottomFullMesh.geometry);
        holder.add(fallback.root);
        ctxRef.current.topLongMesh = fallback.topLongMesh;
        ctxRef.current.topTeeMesh = fallback.topTeeMesh;
        ctxRef.current.bottomFullMesh = fallback.bottomFullMesh;
        ctxRef.current.bottomShortsMesh = fallback.bottomShortsMesh;
        ctxRef.current.topMat = fallback.topMat;
        ctxRef.current.bottomMat = fallback.bottomMat;
        setRigReadySeq((n) => n + 1);
      }
    };

    void mountGarmentRig();

    const resize = (rw: number, rh: number) => {
      const safeW = Math.max(1, rw);
      const safeH = Math.max(1, rh);
      renderer.setSize(safeW, safeH, false);
      camera.aspect = safeW / safeH;
      camera.updateProjectionMatrix();
      requestRender();
    };
    resize(w, h);

    let resizeRaf = 0;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width: nw, height: nh } = entry.contentRect;
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => resize(nw, nh));
    });
    ro.observe(container);

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        isVisible = entry.isIntersecting;
        if (isVisible) requestRender();
        else cancelRender();
      },
      { threshold: 0.01 }
    );
    io.observe(container);

    return () => {
      disposed = true;
      cancelRender();
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      renderer.domElement.removeEventListener(
        "webglcontextrestored",
        onContextRestored
      );
      controls.removeEventListener("start", onControlStart);
      controls.removeEventListener("change", requestRender);
      controls.removeEventListener("end", onControlEnd);
      controls.dispose();
      ctxRef.current?.texPool.forEach((entry) => entry.tex.dispose());
      ctxRef.current?.texPool.clear();
      ctxRef.current?.fallbackTex?.dispose();
      geometriesToDispose.forEach((g) => g.dispose());
      ctxRef.current?.topMat?.normalMap?.dispose();
      ctxRef.current?.bottomMat?.normalMap?.dispose();
      ctxRef.current?.topMat?.dispose();
      ctxRef.current?.bottomMat?.dispose();
      shadowGeom.dispose();
      shadowTex.dispose();
      shadowMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      ctxRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || (!ctx.topLongMesh && !ctx.bottomFullMesh)) return;

    let cancelled = false;

    const framing = getGarmentFraming(product.category, product.cut);
    ctx.holder.position.y = framing.offsetY;
    ctx.shadowPlane.scale.set(framing.shadowScaleX, framing.shadowScaleZ, 1);

    const showTopTee = product.category === "top" && product.cut === "tee";
    const showTopLong = product.category === "top" && product.cut !== "tee";
    const showBottomShorts =
      product.category === "bottom" && product.cut === "shorts";
    const showBottomFull =
      product.category === "bottom" && product.cut !== "shorts";

    if (ctx.topLongMesh) ctx.topLongMesh.visible = false;
    if (ctx.topTeeMesh) ctx.topTeeMesh.visible = false;
    if (ctx.bottomFullMesh) ctx.bottomFullMesh.visible = false;
    if (ctx.bottomShortsMesh) ctx.bottomShortsMesh.visible = false;

    if (showTopTee && ctx.topTeeMesh) ctx.topTeeMesh.visible = true;
    else if (showTopLong && ctx.topLongMesh) ctx.topLongMesh.visible = true;
    else if (showBottomShorts && ctx.bottomShortsMesh)
      ctx.bottomShortsMesh.visible = true;
    else if (showBottomFull && ctx.bottomFullMesh)
      ctx.bottomFullMesh.visible = true;

    const activeMat = product.category === "top" ? ctx.topMat : ctx.bottomMat;
    const sig = getProductSignature(product);

    const getOrCreatePooledTex = (
      signature: string,
      built: BuiltGarmentTextures
    ): THREE.CanvasTexture => {
      const existing = ctx.texPool.get(signature);
      if (existing) {
        ctx.texPool.delete(signature);
        ctx.texPool.set(signature, existing);
        return existing.tex;
      }

      const tex = new THREE.CanvasTexture(built.atlasCanvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = ctx.anisotropy;
      tex.needsUpdate = true;

      // Upload to GPU VRAM once and keep resident in pool
      ctx.renderer.initTexture(tex);

      while (ctx.texPool.size >= 10) {
        const oldestKey = ctx.texPool.keys().next().value;
        if (!oldestKey) break;
        const oldest = ctx.texPool.get(oldestKey);
        oldest?.tex.dispose();
        ctx.texPool.delete(oldestKey);
      }
      ctx.texPool.set(signature, { tex, built });
      return tex;
    };

    const applyBuiltTexture = (
      built: BuiltGarmentTextures,
      tex: THREE.CanvasTexture
    ) => {
      if (!activeMat) return;
      const hadMap = Boolean(activeMat.map);
      updateInteriorLiningColor(activeMat, built.extractedHex);
      activeMat.color.setHex(0xffffff);
      activeMat.map = tex;
      if (!hadMap) {
        activeMat.needsUpdate = true;
      }
      ctx.requestRender();

      onPreviewsBuiltRef.current?.(product.id, {
        front2d: built.front2dDataUrl,
        back2d: built.back2dDataUrl,
        extractedHex: built.extractedHex,
        mappingSummary: built.mappingSummary,
      });

      if (!readyNotifiedRef.current) {
        requestAnimationFrame(() => {
          if (!cancelled && !readyNotifiedRef.current) {
            readyNotifiedRef.current = true;
            onReadyRef.current?.();
          }
        });
      }
    };

    if (activeMat && ctx.appliedSignature !== sig) {
      ctx.appliedSignature = sig;
      const surface = getFabricSurface(product);
      activeMat.roughness = surface.roughness;
      activeMat.normalScale.set(surface.normalScale, surface.normalScale);

      // Fast path 1: Already uploaded in GPU texture pool (0.01ms pointer swap!)
      const pooled = ctx.texPool.get(sig);
      if (pooled) {
        ctx.texPool.delete(sig);
        ctx.texPool.set(sig, pooled);
        applyBuiltTexture(pooled.built, pooled.tex);
        return () => {
          cancelled = true;
        };
      }

      // Fast path 2: Already built in memory cache -> upload once & bind synchronously
      const cachedBuilt = getCachedGarmentTextures(product);
      if (cachedBuilt) {
        const tex = getOrCreatePooledTex(sig, cachedBuilt);
        applyBuiltTexture(cachedBuilt, tex);
        return () => {
          cancelled = true;
        };
      }

      // Slow path: First time building this product's texture
      updateInteriorLiningColor(activeMat, product.mapping.baseColorHex);
      if (!activeMat.map) {
        activeMat.color.set(product.mapping.baseColorHex || "#D8D4CC");
        activeMat.needsUpdate = true;
        ctx.requestRender();
      }

      void buildGarmentTextures(product)
        .then((built) => {
          if (cancelled || !ctxRef.current) return;
          const tex = getOrCreatePooledTex(sig, built);
          applyBuiltTexture(built, tex);
        })
        .catch(() => {
          if (cancelled || !ctxRef.current) return;
          const fallbackTex = makeSolidFallbackTexture(
            product.mapping.baseColorHex
          );
          ctxRef.current.fallbackTex?.dispose();
          ctxRef.current.fallbackTex = fallbackTex;
          const hadMap = Boolean(activeMat.map);
          updateInteriorLiningColor(activeMat, product.mapping.baseColorHex);
          activeMat.color.setHex(0xffffff);
          activeMat.map = fallbackTex;
          if (!hadMap) activeMat.needsUpdate = true;
          ctxRef.current.requestRender();

          if (!readyNotifiedRef.current) {
            requestAnimationFrame(() => {
              if (!cancelled && !readyNotifiedRef.current) {
                readyNotifiedRef.current = true;
                onReadyRef.current?.();
              }
            });
          }
        });
    } else {
      ctx.requestRender();
    }

    return () => {
      cancelled = true;
    };
  }, [product, rigReadySeq]);

  // Background GPU texture pre-upload for sibling slides so sliding 01 <-> 02 <-> 03 is instant
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || rigReadySeq === 0 || !preloadProducts || preloadProducts.length <= 1) {
      return;
    }

    let cancelled = false;
    let timerId: number | null = null;

    const warmGpuQueue = async () => {
      // Let initial hero frame settle before warming sibling slides
      await new Promise<void>((resolve) => {
        timerId = window.setTimeout(resolve, 140);
      });

      for (const item of preloadProducts) {
        if (cancelled || !ctxRef.current) return;
        const sig = getProductSignature(item);
        if (ctxRef.current.texPool.has(sig)) continue;

        try {
          const built =
            getCachedGarmentTextures(item) ?? (await buildGarmentTextures(item));
          if (cancelled || !ctxRef.current) return;
          if (!ctxRef.current.texPool.has(sig)) {
            const tex = new THREE.CanvasTexture(built.atlasCanvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.flipY = false;
            tex.generateMipmaps = true;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.anisotropy = ctxRef.current.anisotropy;
            tex.needsUpdate = true;
            ctxRef.current.renderer.initTexture(tex);
            ctxRef.current.texPool.set(sig, { tex, built });
          }
        } catch {
          // ignore background warm failure
        }

        await new Promise<void>((resolve) => {
          timerId = window.setTimeout(resolve, 110);
        });
      }
    };

    void warmGpuQueue();

    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [preloadProducts, rigReadySeq]);

  const lastFramedProductRef = useRef<string>("");

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const goal = getCameraGoal(product.category, product.cut, anglePreset);
    const productKey = `${product.id}|${product.category}|${product.cut}`;
    const hadPrevious = lastFramedProductRef.current !== "";
    const productChanged = lastFramedProductRef.current !== productKey;
    lastFramedProductRef.current = productKey;

    ctx.goalPos.copy(goal.pos);
    ctx.goalTarget.copy(goal.target);

    if (!hadPrevious || ctx.reducedMotion) {
      ctx.camera.position.copy(goal.pos);
      ctx.controls.target.copy(goal.target);
      ctx.controls.update();
      ctx.transitioning = false;
    } else if (productChanged) {
      // Smooth turntable entrance when sliding between products
      const { centerY, baseDist } = getGarmentFraming(product.category, product.cut);
      const entryAzimuth = 0.78;
      ctx.camera.position.set(
        Math.sin(entryAzimuth) * baseDist,
        centerY + 0.06,
        Math.cos(entryAzimuth) * baseDist
      );
      ctx.controls.target.copy(goal.target);
      ctx.controls.update();
      ctx.transitioning = true;
    } else {
      ctx.transitioning = true;
    }
    ctx.requestRender();
  }, [product.id, product.category, product.cut, anglePreset]);

  if (webglUnavailable && product.mapping.frontImageUrl) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-transparent p-6">
        <Image
          src={product.mapping.frontImageUrl}
          alt={product.title}
          width={420}
          height={420}
          unoptimized
          className="max-h-full w-auto object-contain"
        />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full select-none bg-transparent">
      <div
        ref={containerRef}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        aria-label={`Interactive 3D view of ${product.title}. Drag to rotate 360 degrees, scroll to zoom.`}
      />
    </div>
  );
}
