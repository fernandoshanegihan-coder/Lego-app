/**
 * scene/brickGeometry.ts — procedural LEGO geometry.
 * `spec.md > Components > BuildCanvas`.
 *
 * No LDraw, no asset library: a brick is a rounded-edge box, a plate is the
 * same box one plate thinner, a tile is a box without studs, and a slope is a
 * wedge whose top face is the angled quad. That keeps the renderer's
 * vocabulary and the validator's vocabulary the SAME set — the reason a part
 * that can't be drawn never entered the pool in the first place.
 *
 * Units: one stud pitch = 1 world unit; a plate is 3.2mm against an 8mm stud
 * pitch, so 0.4 units tall. A brick (3 plates) is 1.2 units.
 *
 * Geometries are built once per distinct shape and cached in a module-level
 * Map — there are only a few dozen shapes, and rebuilding per brick would tank
 * the frame rate at 200 bricks.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three-stdlib";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { PartCategory } from "@/lib/types";

/** Height of one plate in world units. */
export const PLATE_HEIGHT = 0.4;
/**
 * A tile is the same thickness as a plate (3.2mm) — it just has no stud on
 * top, which is what makes it read as flat.
 */
export const TILE_HEIGHT = PLATE_HEIGHT;
/** Stud radius and height, in world units. */
const STUD_RADIUS = 0.29;
const STUD_HEIGHT = 0.17;
/** Edge bevel — small, but it is what makes a brick read as LEGO and not as a box. */
const BEVEL = 0.055;

export interface PartShape {
  category: PartCategory;
  /** Footprint in studs. */
  w: number;
  d: number;
  /** Height in plates. */
  h: number;
}

export function shapeHeightUnits(shape: PartShape): number {
  if (shape.category === "tile") return TILE_HEIGHT;
  return shape.h * PLATE_HEIGHT;
}

const cache = new Map<string, THREE.BufferGeometry>();

/** The geometry for a part shape — body plus studs, merged and cached. */
export function geometryFor(shape: PartShape): THREE.BufferGeometry {
  const key = `${shape.category}:${shape.w}x${shape.d}x${shape.h}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const height = shapeHeightUnits(shape);
  const body = bodyGeometry(shape, height).toNonIndexed();
  const studs =
    shape.category === "slope" || shape.category === "tile"
      ? []
      : studGeometries(shape, height).map((g) => g.toNonIndexed());

  // mergeGeometries needs every input to agree on being indexed or not —
  // the rounded body and the stud cylinders do not, hence toNonIndexed above.
  const merged = studs.length ? mergeGeometries([body, ...studs], false) : null;
  if (studs.length && !merged) {
    // Never crash the canvas over a geometry merge — draw the body alone.
    console.warn("[brickbrain] stud merge failed; drawing the body without studs");
  }
  const geometry = merged ?? body;

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  cache.set(key, geometry);
  return geometry;
}

/** Rounded-edge box, sitting on y = 0, centered in x/z. */
function bodyGeometry(shape: PartShape, height: number): THREE.BufferGeometry {
  if (shape.category === "slope") return wedgeGeometry(shape, height);

  const geometry = new RoundedBoxGeometry(shape.w, height, shape.d, 2, BEVEL);
  geometry.translate(0, height / 2, 0);
  return geometry;
}

/** One cylinder per stud on the top face. */
function studGeometries(shape: PartShape, height: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < shape.w; i++) {
    for (let j = 0; j < shape.d; j++) {
      const stud = new THREE.CylinderGeometry(STUD_RADIUS, STUD_RADIUS, STUD_HEIGHT, 16);
      stud.translate(
        -shape.w / 2 + 0.5 + i,
        height + STUD_HEIGHT / 2,
        -shape.d / 2 + 0.5 + j,
      );
      out.push(stud);
    }
  }
  return out;
}

/**
 * A slope: full height at the back edge, tapering to the base at the front,
 * so the top face is the angled quad. It occupies its whole bounding box —
 * which is exactly what the validator assumes ("slopes support nothing").
 */
function wedgeGeometry(shape: PartShape, height: number): THREE.BufferGeometry {
  const w = shape.w;
  const d = shape.d;
  const hw = w / 2;
  const hd = d / 2;

  const positions = new Float32Array([
    // bottom (y = 0)
    -hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd,
    // back top edge (y = height)
    -hw, height, -hd, hw, height, -hd,
  ]);
  const indices = [
    // bottom
    0, 2, 1, 0, 3, 2,
    // back face
    0, 1, 5, 0, 5, 4,
    // slanted top face
    4, 5, 2, 4, 2, 3,
    // left side
    0, 4, 3,
    // right side
    1, 2, 5,
  ];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A stud-grid texture for the baseplate — one canvas, drawn once, tiled
 * across the plate. Far cheaper than 2,304 stud cylinders.
 */
let plateTexture: THREE.Texture | null = null;

export function baseplateTexture(): THREE.Texture {
  if (plateTexture) return plateTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#e3dccc";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#d5cdb9";
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // One stud circle per stud of plate.
  texture.repeat.set(48, 48);
  texture.colorSpace = THREE.SRGBColorSpace;
  plateTexture = texture;
  return texture;
}
