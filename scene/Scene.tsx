"use client";

/**
 * scene/Scene.tsx — the studio: lights, baseplate, orbit, and the bricks.
 *
 * The build is centred on the baseplate: stud coordinates run 0..48, so the
 * scene subtracts half the plate and adds the brick's own footprint, so a
 * brick at (0,0) sits in the corner of the plate, not off its edge.
 */
import { useEffect, useMemo, useRef } from "react";
import { OrbitControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import type { PlacedBrick, Pool } from "@/lib/types";
import { GRID } from "@/validate/grid";
import BrickMesh from "@/scene/BrickMesh";
import { baseplateTexture, shapeHeightUnits, type PartShape } from "@/scene/brickGeometry";

/** A placed brick plus the pool facts the renderer needs. */
export interface RenderableBrick {
  brick: PlacedBrick;
  shape: PartShape;
  colorHex: string;
  transparent: boolean;
}

export function renderables(bricks: PlacedBrick[], pool: Pool): RenderableBrick[] {
  const out: RenderableBrick[] = [];
  for (const brick of bricks) {
    const owned = pool.get(`${brick.partNum}:${brick.colorId}`);
    if (!owned) continue; // never draw a brick the kernel wouldn't accept
    out.push({
      brick,
      shape: { category: owned.category, w: owned.w, d: owned.d, h: owned.h },
      colorHex: owned.colorHex,
      transparent: owned.isTrans,
    });
  }
  return out;
}

/** Footprint after rotation — 90° and 270° swap w and d. */
function footprint(shape: PartShape, rot: number): { w: number; d: number } {
  return rot === 90 || rot === 270 ? { w: shape.d, d: shape.w } : { w: shape.w, d: shape.d };
}

export default function Scene({
  bricks,
  pool,
  revealed,
}: {
  bricks: PlacedBrick[];
  pool: Pool;
  /** How many bricks are visible so far — the layer-by-layer reveal. */
  revealed: number;
}) {
  const items = useMemo(() => renderables(bricks, pool), [bricks, pool]);
  const plate = useMemo(() => baseplateTexture(), []);
  const { camera } = useThree();
  const orbitRef = useRef<OrbitControlsImpl | null>(null);

  // Bottom-up, so the model assembles itself in a believable order.
  const ordered = useMemo(
    () => [...items].sort((a, b) => a.brick.y - b.brick.y || a.brick.z - b.brick.z),
    [items],
  );
  const visible = ordered.slice(0, revealed);

  // Centre the build on the baseplate: the model's coordinates are absolute
  // (0..48 studs), but the camera and the plate want it in the middle.
  const center = useMemo(() => {
    if (items.length === 0) return { x: 0, z: 0, radius: 3, width: 4, depth: 4, height: 0 };
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let maxY = 0;
    for (const item of items) {
      const { w, d } = footprint(item.shape, item.brick.rot);
      minX = Math.min(minX, item.brick.x);
      maxX = Math.max(maxX, item.brick.x + w);
      minZ = Math.min(minZ, item.brick.z);
      maxZ = Math.max(maxZ, item.brick.z + d);
      maxY = Math.max(maxY, item.brick.y * 0.4 + shapeHeightUnits(item.shape));
    }
    // Half the diagonal of the bounding box — the camera frames that sphere.
    const dx = (maxX - minX) / 2;
    const dz = (maxZ - minZ) / 2;
    return {
      x: (minX + maxX) / 2,
      z: (minZ + maxZ) / 2,
      radius: Math.max(2.5, Math.sqrt(dx * dx + dz * dz + maxY * maxY)),
      width: maxX - minX,
      depth: maxZ - minZ,
      height: maxY,
    };
  }, [items]);

  // Frame the build: the camera moves to it when the design changes.
  useEffect(() => {
    if (items.length === 0) return;
    // Distance follows the build's real size: a 12-stud wall needs a wider
    // shot than a 4-stud stack, and the vertical fov is ~38°.
    const distance = Math.min(
      70,
      Math.max(10, center.width * 1.7, center.depth * 1.7, center.height * 2.4),
    );
    // The bricks are placed relative to the build's centre, so the build sits
    // at the origin — the camera must aim there, not at the raw coordinates.
    const look = { x: 0, y: center.height * 0.5, z: 0 };
    camera.position.set(
      look.x + distance * 0.55,
      look.y + distance * 0.5,
      look.z + distance * 0.72,
    );
    camera.lookAt(look.x, look.y, look.z);
    const orbit = orbitRef.current;
    if (orbit) {
      orbit.target.set(look.x, look.y, look.z);
      orbit.update();
    }
  }, [camera, center, items.length]);

  return (
    <>
      <color attach="background" args={["#ebe5d8"]} />
      <ambientLight intensity={0.45} />
      <hemisphereLight args={["#fff8e8", "#b9ae99", 0.35]} />
      <directionalLight
        position={[14, 22, 10]}
        intensity={1.15}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
      />
      <directionalLight position={[-12, 8, -14]} intensity={0.3} />

      {/* The baseplate — a warm stud grid the build stands on. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[GRID.studsX, GRID.studsZ]} />
        <meshStandardMaterial map={plate} roughness={0.95} />
      </mesh>

      {visible.map((item) => {
        const { brick, shape } = item;
        const { w, d } = footprint(shape, brick.rot);
        const y = brick.y * 0.4;
        return (
          <BrickMesh
            key={brick.id}
            shape={shape}
            colorHex={item.colorHex}
            transparent={item.transparent}
            position={[brick.x - center.x + w / 2, y, brick.z - center.z + d / 2]}
            rotation={[0, (brick.rot * Math.PI) / 180, 0]}
          />
        );
      })}

      <OrbitControls
        ref={orbitRef}
        makeDefault
        target={[0, center.height * 0.5, 0]}
        minDistance={4}
        maxDistance={90}
        maxPolarAngle={Math.PI / 2.05}
      />
    </>
  );
}

export { shapeHeightUnits };
