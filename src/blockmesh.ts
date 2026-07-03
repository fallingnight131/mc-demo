// 以图集纹理构建某方块的小立方体几何(掉落物 / 点燃的 TNT 实体)
import * as THREE from 'three';
import { BLOCK_DEFS, tileUV } from './blocks';

/**
 * BoxGeometry 的面顺序为 +x,-x,+y,-y,+z,-z,与 BlockDef.tiles 一致。
 * 把每个面的默认 [0,1] UV 重映射到对应纹理格。
 */
export function buildBlockGeometry(blockId: number, size: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(size, size, size);
  const tiles = BLOCK_DEFS[blockId].tiles!;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let face = 0; face < 6; face++) {
    const { u0, v0, u1, v1 } = tileUV(tiles[face]);
    for (let i = 0; i < 4; i++) {
      const idx = face * 4 + i;
      uv.setXY(idx, u0 + uv.getX(idx) * (u1 - u0), v0 + uv.getY(idx) * (v1 - v0));
    }
  }
  uv.needsUpdate = true;
  return geo;
}
