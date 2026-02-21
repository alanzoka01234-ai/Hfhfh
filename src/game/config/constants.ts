
// Add missing import for PlayerStats interface
import { PlayerStats } from '../../types';

export const COLORS = {
  PLAYER: '#8b5cf6', // Purple 500
  ENEMY: '#ff3355',  // Keeping Red for contrast but slightly adjusted
  BOSS: '#6d28d9',   // Darker Purple
  XP: '#a855f7',     // Light Purple
  BULLET: '#ffffff',
  BACKGROUND: '#050505',
  GRID: '#121214',
};

export const INITIAL_STATS: PlayerStats = {
  maxHp: 100,
  hp: 100,
  speed: 4,
  damage: 3,
  attackSpeed: 2.0,
  range: 200,
  xp: 0,
  nextLevelXp: 40, // Reduzido de 50 para progressão inicial mais rápida
  level: 1,
  coins: 0,
  multiShot: 1,
  regenLevel: 0,
  knockback: 1.0,
  hasSpray: false,
  accuracy: 0.02, // Spread angle in radians (lower is better)
  hasSniper: false,
  hasGlassCannon: false,
  hasTank: false,
  droneLevel: 0,
  fearLevel: 0,
  freezeLevel: 0,
  auraLevel: 0,
  pulseLevel: 0,
  xpGainLevel: 0,
  realOrbAffinity: 0,
  extraOrbChanceLevel: 0,
  magnetLevel: 0,
  pullSpeedLevel: 0,
  creditsLevel: 0,
  speedLevel: 0,
  hasDash: false,
  dashCdLevel: 0,
  handlingLevel: 0,
  hitboxLevel: 0,
  hpPlusLevel: 0,
  armorLevel: 0,
  shieldLevel: 0,
  shield: 0,
  maxShield: 0,
  iFrameLevel: 0,
  bulletResistLevel: 0,
  healOnKillLevel: 0,
  knockbackLevel: 0,
  slowLevel: 0,
  burnLevel: 0,
  gaussLevel: 1,
};

export const ROUND_DURATION = 22500; // Reduzido de 30s para 22.5s (25% mais rápido)
// Hard cap (perf safety). The engine also uses a dynamic cap by round.
export const MAX_ENEMIES = 80;
export const REGEN_INTERVAL = 10000; // 10 seconds
