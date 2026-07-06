// 全局常量配置
export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 96;
export const SEA_LEVEL = 24;
export const SNOW_LEVEL = 52;

// --- Terraria 3D:有限世界结构(Phase 1) ---
/** 大陆基准半径(方块),海岸线在此基础上随噪声起伏 */
export const CONTINENT_RADIUS = 400;
/** 海岸过渡带宽度:陆地经沙滩缓降入海 */
export const COAST_WIDTH = 90;
/** 空气墙半径:海面延伸到此,超出不可移动/放置 */
export const WORLD_WALL_RADIUS = 620;
/** 山脉带:围绕出生地的环形山脉(内/外半径),脊线随噪声蜿蜒 */
export const RANGE_INNER = 150;
export const RANGE_OUTER = 300;

export const RENDER_DISTANCE = 5; // 网格化区块半径(切比雪夫距离)
export const DATA_DISTANCE = RENDER_DISTANCE + 1; // 地形数据生成半径
export const UNLOAD_DISTANCE = RENDER_DISTANCE + 3; // 超出该半径卸载区块

export const GRAVITY = 28;
export const JUMP_SPEED = 8.6;
export const WALK_SPEED = 4.5;
export const SPRINT_SPEED = 7.0;
export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;
export const REACH = 6; // 交互距离(方块)

export const SEED = 1337;
