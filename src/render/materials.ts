// 渲染层 · 世界材质:方块图集材质(块光照 + 树叶摇曳注入)与水面材质
import * as THREE from 'three';
import { buildTextures, buildWaterTexture, type GameTextures } from '../textures';

export interface WorldMaterials {
  textures: GameTextures;
  solidMat: THREE.MeshBasicMaterial;
  waterMat: THREE.MeshBasicMaterial;
  waterTex: THREE.CanvasTexture;
  /** 昼夜亮度(shader uniform):最终亮度 = max(uDay, 块光) */
  dayUniform: { value: number };
  /** 树叶/植被随风摇曳的时间 uniform */
  timeUniform: { value: number };
}

export function createWorldMaterials(): WorldMaterials {
  const textures = buildTextures();
  const solidMat = new THREE.MeshBasicMaterial({
    map: textures.atlas,
    vertexColors: true,
    alphaTest: 0.5, // 玻璃等镂空纹理
  });
  // 块光照:顶点属性 aLight(0..1),最终亮度 = max(昼夜, 块光)。
  // 昼夜不乘在材质 color 上而是走 uniform,火把夜里才能保持亮。
  const dayUniform = { value: 1 };
  const timeUniform = { value: 0 };
  solidMat.onBeforeCompile = (shader) => {
    shader.uniforms.uDay = dayUniform;
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aLight;\nattribute float aSway;\nuniform float uTime;\nvarying float vLight;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvLight = aLight;\n' +
          'transformed.x += aSway * 0.05 * sin(uTime * 1.6 + position.x * 0.9 + position.y * 0.55);\n' +
          'transformed.z += aSway * 0.05 * sin(uTime * 1.25 + position.z * 0.85 + position.y * 0.4);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDay;\nvarying float vLight;')
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n  diffuseColor.rgb *= max(uDay, vLight);',
      );
  };

  const waterTex = buildWaterTexture();
  const waterMat = new THREE.MeshBasicMaterial({
    map: waterTex,
    vertexColors: true,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  return { textures, solidMat, waterMat, waterTex, dayUniform, timeUniform };
}
