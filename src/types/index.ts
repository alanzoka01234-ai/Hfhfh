
export enum GameState {
  MENU,
  PLAYING,
  LEVEL_UP,
  GAME_OVER,
  PAUSED
}

export interface PlayerStats {
  maxHp: number;
  hp: number;
  speed: number;
  damage: number;
  attackSpeed: number; // multiplier
  range: number;
  xp: number;
  nextLevelXp: number;
  level: number;
  coins: number;
  multiShot: number;
  regenLevel: number;
  knockback: number; // base value
  hasSpray: boolean;
  accuracy: number; // Spread angle in radians (lower is better)
  hasSniper: boolean;
  hasGlassCannon: boolean;
  hasTank: boolean;
  droneLevel: number;
  fearLevel: number;
  freezeLevel: number;
  auraLevel: number;
  pulseLevel: number;
  xpGainLevel: number;
  realOrbAffinity: number;
  extraOrbChanceLevel: number;
  magnetLevel: number;
  pullSpeedLevel: number;
  creditsLevel: number;
  speedLevel: number;
  hasDash: boolean;
  dashCdLevel: number;
  handlingLevel: number;
  hitboxLevel: number;
  hpPlusLevel: number;
  armorLevel: number;
  shieldLevel: number;
  shield: number;
  maxShield: number;
  iFrameLevel: number;
  bulletResistLevel: number;
  healOnKillLevel: number;
  knockbackLevel: number;
  slowLevel: number;
  burnLevel: number;

  // Weapon: Gauss Cannon progression (1..8)
  gaussLevel: number;
}

export interface Upgrade {
  id: string;
  name: string;
  description: string;
  icon: string;
  type: 'stat' | 'weapon';
  isRare?: boolean;
  apply: (stats: PlayerStats) => PlayerStats;
}

export interface SavedData {
  totalCoins: number;
  selectedSkin: string;
  unlockedSkins: string[];
  sfxEnabled: boolean;
  permanentUpgrades: {
    health: number;
    damage: number;
    speed: number;
  };
}

export interface Point {
  x: number;
  y: number;
}
