"use client";

/**
 * scene/BrickMesh.tsx — one brick: cached geometry, cached material, placed.
 *
 * The geometry is shared per shape and the material per colour, so a 200-brick
 * build is ~200 draw calls with no duplicated buffers.
 */
import { useMemo } from "react";
import * as THREE from "three";
import { geometryFor, type PartShape } from "@/scene/brickGeometry";

const materials = new Map<string, THREE.MeshStandardMaterial>();

function materialFor(hex: string, transparent: boolean): THREE.MeshStandardMaterial {
  const key = `${hex}:${transparent}`;
  const hit = materials.get(key);
  if (hit) return hit;
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex),
    roughness: transparent ? 0.25 : 0.55,
    metalness: 0.02,
    transparent,
    opacity: transparent ? 0.72 : 1,
  });
  materials.set(key, material);
  return material;
}

export default function BrickMesh({
  shape,
  colorHex,
  transparent,
  position,
  rotation,
}: {
  shape: PartShape;
  colorHex: string;
  transparent: boolean;
  position: [number, number, number];
  rotation: [number, number, number];
}) {
  const geometry = useMemo(() => geometryFor(shape), [shape]);
  const material = useMemo(
    () => materialFor(colorHex, transparent),
    [colorHex, transparent],
  );

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={position}
      rotation={rotation}
      castShadow
      receiveShadow
    />
  );
}
