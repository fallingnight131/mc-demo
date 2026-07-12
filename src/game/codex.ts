// 系统层 · 图鉴数据:分类条目从物品注册表派生(名称/说明/图标)。
// 新方块/物品入注册表后,这里只需把 id 加进对应分类(或按 kind 自动归类)。
import { Block } from '../blocks';
import { itemDesc, itemIcon, itemName, type IconSource } from '../content/items';
import type { CodexCategory } from '../hud';
import { buildMobTextures } from '../textures';
import { Equip, Tool } from '../tools';

const entry = (icons: IconSource, id: number) => ({
  icon: itemIcon(icons, id),
  name: itemName(id),
  desc: itemDesc(id),
});

/** 僵尸脸图标(取生物贴图的脸,放大 3×) */
function zombieFaceIcon(): HTMLCanvasElement {
  const face = buildMobTextures().zombie.face;
  const c = document.createElement('canvas');
  c.width = 48;
  c.height = 48;
  const cx = c.getContext('2d')!;
  cx.imageSmoothingEnabled = false;
  cx.drawImage(face.image as CanvasImageSource, 0, 0, 16, 16, 0, 0, 48, 48);
  return c;
}

export function buildCodexCategories(icons: IconSource): CodexCategory[] {
  const e = (id: number) => entry(icons, id);
  return [
    {
      title: '方块 · 建材',
      entries: [
        Block.Grass, Block.Dirt, Block.Stone, Block.Cobble, Block.Sand, Block.Sandstone,
        Block.Snow, Block.Glass, Block.Plank, Block.Log, Block.Leaves, Block.Brick,
        Block.StoneBrick, Block.Obsidian, Block.Pumpkin, Block.Cloud, Block.DungeonBrick,
      ].map(e),
    },
    {
      title: '矿物 · 金属',
      entries: [
        Block.CoalOre, Block.IronOre, Block.GoldOre, Block.DiamondOre,
        Block.IronBlock, Block.GoldBlock, Block.DiamondBlock,
      ].map(e),
    },
    {
      title: '家具 · 可交互',
      entries: [Block.Torch, Block.Glowstone, Block.TNT, Block.Chest].map(e),
    },
    {
      title: '工具 · 武器',
      entries: [Tool.Sword, Tool.Pickaxe, Tool.Axe, Tool.FlintSteel].map(e),
    },
    {
      title: '装备 · 饰品',
      entries: [
        Equip.IronHelmet, Equip.IronChest, Equip.IronLegs,
        Equip.SwiftCharm, Equip.CloudBottle, Equip.Horseshoe,
      ].map(e),
    },
    {
      title: '植被 · 依环境生长',
      entries: [
        Block.TallGrass, Block.Flower, Block.JungleFern, Block.CorruptThorn, Block.CrimsonVine,
      ].map(e),
    },
    {
      title: '生物',
      entries: [{ icon: zombieFaceIcon(), name: '僵尸', desc: '夜间敌人 · 惧光 · 日光下燃烧' }],
    },
  ];
}
