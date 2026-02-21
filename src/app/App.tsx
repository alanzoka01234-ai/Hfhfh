
import { useEffect, useRef, useState, useCallback, useMemo, type CSSProperties } from 'react';
import { GameEngine } from '../game/engine/GameEngine';
import { GameState, Upgrade, SavedData, PlayerStats } from '../types';
import { PersistenceService } from '../services/persistence';
import { AudioService } from '../services/AudioService';

// Heavy mode: capture DOM into a canvas and apply the WebGL CRT shader to EVERYTHING.
// We load html2canvas dynamically only when needed.
declare global {
  interface Window {
    html2canvas?: (el: HTMLElement, opts?: any) => Promise<HTMLCanvasElement>;
  }
}

// Version label (update this on each release)
const APP_VERSION = 'v1.9.5';
const APP_UPDATE_NOTES = [
  'v1.9.5 - Player fixo: maxHp=100, hp inicial=100 e dano=3 (sem buffs por level/upgrades).',
  'v1.9.4 - Zoom travado em 50% (0.5), sem controles de zoom.',
  'v1.9.3 - Fix build: HealthPickup.update agora soma ageMs (corrige dtMs unused).',
  'v1.9.1 - Fix build: estruturas de cobertura (métodos/fields) + ajuste ageMs do inimigo.',
  'v1.9.0 - Coberturas: estruturas bloqueiam inimigos, quebram com DPS de contato e dropam cura (pickups).',
  'v1.8.3 - Movimento: velocidade menor e fricção maior (menos deslize).',
  'v1.8.2 - Tiro do player só dispara com inimigo perto (<=160px).',
  'v1.6.0 - Chão com textura repetida (tile): renderiza floor-tile.png repetindo conforme a câmera se move. (Você pode substituir public/floor-tile.png pela sua textura.)',
  'v1.5.2 - Build fix: gaussLevel tipado/compatível (corrige TS2339 no App.tsx).',
  'v1.4.0 - Câmera corrigida: movimento real em world coords (player.worldX/worldY). Câmera só afeta o render (world->screen). Inimigos/balas/drops e colisões não dependem da tela.',
  'v1.0.1 - Correção de câmera: lógica 100% em coordenadas do mundo (sem clamp na tela). Render usa offset da câmera; inimigos/balas/XP e colisões ficam corretos.',
  'v0.2.3 - Menu: fundo agora estático (sem rolagem) e sem blur por cima da imagem.',
  'v0.2.2 - Removido blur do fundo e ajustado tamanho da imagem para caber na tela sem corte.',
  '• Clique no número da versão (canto inferior direito) para abrir esta tela.',
  '• Menu: removido o fundo “Play Demo” e adicionado um fundo animado com imagem em rolagem vertical.',
  '• Menu: fundo animado agora inicia já preenchendo a tela; imagem movida para /public (menu-bg.png).',
  '• Ajustes visuais: removido o brilho/luz (glow) do Player e dos inimigos.',
  '• UI: botão principal renomeado para “Iniciar Jogo”.',
  '• Sprites: Player e inimigo vermelho usam imagem quando disponível.',
].join('\n');

const UPGRADES: Upgrade[] = [
{
  id: 'gauss',
  name: 'Canhão Gauss',
  description: 'Evolui a arma principal (Lv +1 até 8): +dano/+cadência/+perfuração/Overcharge.',
  icon: '🧲',
  type: 'stat',
  apply: (s) => {
    if ((s as any).gaussLevel >= 8) return s;
    const next = (s as any).gaussLevel + 1;
    let ns = { ...s, gaussLevel: next };
    // L2 +15% dano
    if (next === 2) ns = { ...ns, damage: ns.damage * 1.15 };
    // L3 +10% cadência
    if (next === 3) ns = { ...ns, attackSpeed: ns.attackSpeed * 1.10 };
    // L4 +1 perfuração (aplicado no tiro via gaussLevel)
    // L5 +15% dano
    if (next === 5) ns = { ...ns, damage: ns.damage * 1.15 };
    // L6 +10% cadência
    if (next === 6) ns = { ...ns, attackSpeed: ns.attackSpeed * 1.10 };
    // L7 +1 perfuração (aplicado no tiro via gaussLevel)
    // L8 Overcharge (aplicado no tiro via gaussLevel)
    return ns;
  },
},
  { id: 'hp', name: 'Nano-Reinforcement', description: 'Max HP +20', icon: '🔋', type: 'stat', apply: (s) => ({ ...s, maxHp: s.maxHp + 20, hp: s.hp + 20 }) },
  { id: 'hp_plus', name: 'HP +', description: 'Max HP +10 per level (Max +180).', icon: '❤️', type: 'stat', apply: (s) => (s.hpPlusLevel >= 18 ? s : ({ ...s, hpPlusLevel: s.hpPlusLevel + 1, maxHp: s.maxHp + 10, hp: s.hp + 10 })) },
  { id: 'dmg', name: 'Laser Overclock', description: 'Damage +5', icon: '⚡', type: 'stat', apply: (s) => ({ ...s, damage: s.damage + 5 }) },
  { id: 'ms', name: 'Splitter Core', description: 'Multi-Shot +1 (Max 6)', icon: '🔱', type: 'stat', apply: (s) => ({ ...s, multiShot: Math.min(s.multiShot + 1, 6) }) },
  { id: 'atk', name: 'Fast Reloader', description: 'Attack Speed +9% (Cap 3.0x)', icon: '🔫', type: 'stat', apply: (s) => ({ ...s, attackSpeed: Math.min(s.attackSpeed * 1.09, 3.0) }) },
  { id: 'rng', name: 'Magnet Core', description: 'Pickup Range +15% (Cap 520)', icon: '🧲', type: 'stat', apply: (s) => ({ ...s, range: Math.min(s.range * 1.15, 520) }) },
  { id: 'regen', name: 'REGEN', description: 'Heal (0.6% + 0.9%/lvl) Max HP every 10s (Max 12%).', icon: '🏥', type: 'stat', apply: (s) => ({ ...s, regenLevel: Math.min(s.regenLevel + 1, 10) }) },
  { id: 'armor', name: 'ARMOR', description: 'Damage Reduction +3% per level (Max 30%).', icon: '🛡️', type: 'stat', apply: (s) => ({ ...s, armorLevel: Math.min(s.armorLevel + 1, 10) }) },
  {
    id: 'shield',
    name: 'SHIELD',
    description: 'Extra energy layer. Recharges after 3s without damage.',
    icon: '💎',
    type: 'stat',
    apply: (s) => {
      if (s.shieldLevel >= 10) return s;
      const newLevel = s.shieldLevel + 1;
      const newMax = 20 + newLevel * 10;
      return { ...s, shieldLevel: newLevel, maxShield: newMax, shield: Math.min(s.shield + 10, newMax) };
    }
  },
  {
    id: 'iframes',
    name: 'I-FRAMES',
    description: 'Invulnerability after taking damage +0.04s per level (Max ~0.46s).',
    icon: '👻',
    type: 'stat',
    apply: (s) => ({ ...s, iFrameLevel: Math.min(s.iFrameLevel + 1, 6) })
  },
  {
    id: 'bullet_resist',
    name: 'BULLET RESIST',
    description: 'Reduces damage from projectiles by 3% per level (Max 30%).',
    icon: '🛑',
    type: 'stat',
    apply: (s) => ({ ...s, bulletResistLevel: Math.min(s.bulletResistLevel + 1, 10) })
  },
  {
    id: 'heal_kill',
    name: 'HEAL ON KILL',
    description: 'Heal 1% +0.5%/lvl of Max HP on every kill (Max 5.5%).',
    icon: '🩸',
    type: 'stat',
    apply: (s) => ({ ...s, healOnKillLevel: Math.min(s.healOnKillLevel + 1, 10) })
  },
  {
    id: 'knockback_plus',
    name: 'KNOCKBACK',
    description: 'Increases bullet impact force by +10% per level.',
    icon: '👊',
    type: 'stat',
    apply: (s) => ({ ...s, knockbackLevel: Math.min(s.knockbackLevel + 1, 10) })
  },
  {
    id: 'slow_shot',
    name: 'SLOW SHOT',
    description: 'Bullets slow enemy speed by +4% per level for 1.2s.',
    icon: '🧊',
    type: 'stat',
    apply: (s) => ({ ...s, slowLevel: Math.min(s.slowLevel + 1, 10) })
  },
  {
    id: 'burn_shot',
    name: 'BURN',
    description: 'Bullets ignite enemies. Burn DPS scales with damage; duration increases with level.',
    icon: '🔥',
    type: 'stat',
    apply: (s) => ({ ...s, burnLevel: Math.min(s.burnLevel + 1, 10) })
  },
  {
    id: 'spray',
    name: 'Neural Spray',
    description: 'Fire Rate +55%, Damage -25%, Spread +25%',
    icon: '🤑🤑🤑',
    type: 'stat',
    isRare: true,
    apply: (s) => ({
      ...s,
      attackSpeed: Math.min(s.attackSpeed * 1.55, 3.0),
      damage: Math.max(1, s.damage * 0.75),
      accuracy: Math.min(0.35, s.accuracy * 1.25),
      knockback: s.knockback * 1.15,
      hasSpray: true
    })
  },
  {
    id: 'sniper',
    name: 'Neural Sniper',
    description: 'Damage +100%, Fire Rate -25%, Precision +50%',
    icon: '🎯',
    type: 'stat',
    isRare: true,
    apply: (s) => ({
      ...s,
      damage: s.damage * 2.0,
      attackSpeed: s.attackSpeed * 0.75,
      accuracy: s.accuracy * 0.5,
      hasSniper: true
    })
  },
  {
    id: 'glass_cannon',
    name: 'Glass Cannon',
    description: 'Damage +55%, Max HP -25% (CRITICAL RISK)',
    icon: '💎',
    type: 'stat',
    isRare: true,
    apply: (s) => {
      const newMax = Math.max(10, Math.floor(s.maxHp * 0.75));
      return {
        ...s,
        damage: s.damage * 1.55,
        maxHp: newMax,
        hp: Math.min(s.hp, newMax),
        hasGlassCannon: true
      };
    }
  },
  {
    id: 'tank',
    name: 'The Tank',
    description: 'Max HP +45%, Fire Rate -15%',
    icon: '🛡️',
    type: 'stat',
    isRare: true,
    apply: (s) => ({
      ...s,
      maxHp: Math.floor(s.maxHp * 1.45),
      hp: s.hp + Math.floor(s.maxHp * 0.45),
      attackSpeed: s.attackSpeed * 0.85,
      hasTank: true
    })
  },
  {
    id: 'drone',
    name: 'Combat Drone',
    description: 'Auto-firing orbiting turret. Level up for Speed/Damage.',
    icon: '🤖',
    type: 'weapon',
    apply: (s) => ({ ...s, droneLevel: Math.min(s.droneLevel + 1, 10) })
  },
  {
    id: 'fear',
    name: 'Neuro Fear',
    description: 'Every 10s, nearby enemies retreat. Level up for duration.',
    icon: '😱',
    type: 'stat',
    apply: (s) => ({ ...s, fearLevel: Math.min(s.fearLevel + 1, 10) })
  },
  {
    id: 'freeze',
    name: 'Cryo Pulse',
    description: 'Every 12s, freeze nearby enemies. Level up for duration.',
    icon: '❄️',
    type: 'stat',
    apply: (s) => ({ ...s, freezeLevel: Math.min(s.freezeLevel + 1, 10) })
  },
  {
    id: 'aura',
    name: 'Damage Aura',
    description: 'Deals damage to nearby enemies every 0.2s. Radius increases with level.',
    icon: '⭕',
    type: 'stat',
    apply: (s) => ({ ...s, auraLevel: Math.min(s.auraLevel + 1, 10) })
  },
  {
    id: 'pulse',
    name: 'Shockwave Pulse',
    description: 'Every 8s, releases a wave that pushes and damages enemies (cooldown scales).',
    icon: '💥',
    type: 'stat',
    apply: (s) => ({ ...s, pulseLevel: Math.min(s.pulseLevel + 1, 10) })
  },
  {
    id: 'xp_gain',
    name: 'XP Amplifier',
    description: 'Increase XP from real orbs by +6% per level (Max 12).',
    icon: '📈',
    type: 'stat',
    apply: (s) => ({ ...s, xpGainLevel: Math.min(s.xpGainLevel + 1, 12) })
  },
  {
    id: 'orb_affinity',
    name: 'Real Orb Affinity',
    description: 'Reduces the levels required to drop more real XP orbs by -2.',
    icon: '💠',
    type: 'stat',
    apply: (s) => ({ ...s, realOrbAffinity: Math.min(s.realOrbAffinity + 1, 2) })
  },
  {
    id: 'extra_orb',
    name: 'Visual Overload',
    description: 'Chance to spawn a bonus orb by +6% per level.',
    icon: '✨',
    type: 'stat',
    apply: (s) => ({ ...s, extraOrbChanceLevel: Math.min(s.extraOrbChanceLevel + 1, 10) })
  },
  {
    id: 'magnet_plus',
    name: 'MAGNET +',
    description: 'Increases magnet radius by +7% per level.',
    icon: '🧭',
    type: 'stat',
    apply: (s) => ({ ...s, magnetLevel: Math.min(s.magnetLevel + 1, 12) })
  },
  {
    id: 'pull_speed',
    name: 'PICKUP SPEED',
    description: 'Increases magnet force (orbs move faster) by +10% per level.',
    icon: '🧲',
    type: 'stat',
    apply: (s) => ({ ...s, pullSpeedLevel: Math.min(s.pullSpeedLevel + 1, 10) })
  },
  {
    id: 'credits_plus',
    name: 'CREDITS +',
    description: 'Increases credits earned by +8% per level.',
    icon: '💎',
    type: 'stat',
    apply: (s) => ({ ...s, creditsLevel: Math.min(s.creditsLevel + 1, 10) })
  },
  {
    id: 'speed_plus',
    name: 'SPEED +',
    description: 'Increases movement speed by +4% per level (Max 48%).',
    icon: '🏃',
    type: 'stat',
    apply: (s) => ({ ...s, speedLevel: Math.min(s.speedLevel + 1, 12) })
  },
  {
    id: 'dash_unlock',
    name: 'DASH',
    description: 'Unlocks a quick dash. Use Shift or Button.',
    icon: '💨',
    type: 'weapon',
    isRare: true,
    apply: (s) => ({ ...s, hasDash: true })
  },
  {
    id: 'dash_cd',
    name: 'DASH CD -',
    description: 'Reduces dash cooldown by 7% per level.',
    icon: '⏲️',
    type: 'stat',
    apply: (s) => ({ ...s, dashCdLevel: Math.min(s.dashCdLevel + 1, 10) })
  },
  {
    id: 'handling',
    name: 'HANDLING',
    description: 'Increases acceleration and turn response by ~8% per level.',
    icon: '🕹️',
    type: 'stat',
    apply: (s) => ({ ...s, handlingLevel: Math.min(s.handlingLevel + 1, 10) })
  },
  {
    id: 'hitbox_reduction',
    name: 'HITBOX -',
    description: 'Reduces collision radius by 2.5% per level (Max 20%).',
    icon: '🎯',
    type: 'stat',
    apply: (s) => ({ ...s, hitboxLevel: Math.min(s.hitboxLevel + 1, 8) })
  },
];

const SKINS = [
  { id: 'default', name: 'VIOLET CORE', color: '#8b5cf6', price: 0 },
  { id: 'pink', name: 'NEON ROSE', color: '#ff00ff', price: 200 },
  { id: 'green', name: 'ACID GREEN', color: '#00ff00', price: 200 },
  { id: 'blue', name: 'DEEP BLUE', color: '#3b82f6', price: 250 },
  { id: 'gold', name: 'GOLDEN GRID', color: '#ffd700', price: 600 },
];

type PermanentUpgradeKey = keyof SavedData['permanentUpgrades'];

const PERMANENT_UPGRADES: Array<{
  key: PermanentUpgradeKey;
  name: string;
  description: string;
  icon: string;
  baseCost: number;
  costMult: number;
  maxLevel: number;
  effectText: (level: number) => string;
}> = [
  {
    key: 'health',
    name: 'MAX HP',
    description: 'Start each run with extra maximum HP.',
    icon: '💚',
    baseCost: 120,
    costMult: 1.45,
    maxLevel: 15,
    effectText: (lvl) => `+${(lvl + 1) * 10} Max HP at start`,
  },
  {
    key: 'damage',
    name: 'DAMAGE',
    description: 'Start each run with more weapon damage.',
    icon: '💢',
    baseCost: 0,
    costMult: 0,
    maxLevel: 15,
    effectText: (lvl) => `+${(lvl + 100) * 50} Damage at start`,
  },
  {
    key: 'speed',
    name: 'SPEED',
    description: 'Start each run faster and more responsive.',
    icon: '🏃',
    baseCost: 110,
    costMult: 1.42,
    maxLevel: 12,
    effectText: (lvl) => `+${Math.round((lvl + 1) * 5)}% Move speed at start`,
  },
];


export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const bulletGlCanvasRef = useRef<HTMLCanvasElement>(null);
  const captureRootRef = useRef<HTMLDivElement>(null);
  const uiLayerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [gameState, setGameState] = useState<GameState>(GameState.MENU);
  const [menuScreen, setMenuScreen] = useState<'MAIN' | 'SHOP' | 'CREDITS'>('MAIN');
  const [storeTab, setStoreTab] = useState<'UPGRADES' | 'SKINS'>('UPGRADES');
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [randomUpgrades, setRandomUpgrades] = useState<Upgrade[]>([]);
  const [savedData, setSavedData] = useState<SavedData>(PersistenceService.load());
  const [round, setRound] = useState(1);
  const [dashCdPercent, setDashCdPercent] = useState(0);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [showUpdateNotes, setShowUpdateNotes] = useState(false);

  // Settings UI (visual + audio)
  type CrtPreset = 'off' | 'lite' | 'classic' | 'vhs' | 'ultra' | 'royale' | 'guest-advanced' | 'geom-deluxe' | 'lottes' | 'vector-glow' | 'hsm-mega-bezel-reflection';
  type BulletPreset = 'neon-core' | 'plasma-pulse' | 'ion-beamlet' | 'void-shot' | 'overcharge';
  type GraphicsQuality = 'low' | 'medium' | 'high';
  const SETTINGS_KEY = 'neon_ui_settings_v2';
  const SETTINGS_KEY_LEGACY = 'neon_ui_settings_v1';
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [crtPreset, setCrtPreset] = useState<CrtPreset>('off');
  const [sfxVolume, setSfxVolume] = useState(0.5);
  const [musicVolume, setMusicVolume] = useState(0.35);
  const [crtShaderEnabled, setCrtShaderEnabled] = useState(false);
  const [crtShaderApplyToUi, setCrtShaderApplyToUi] = useState(false);
  const [bulletShaderEnabled, setBulletShaderEnabled] = useState(true);
  const [bulletPreset, setBulletPreset] = useState<BulletPreset>('neon-core');
  const [graphicsQuality, setGraphicsQuality] = useState<GraphicsQuality>('medium');
  const [bulletShaderError, setBulletShaderError] = useState<string | null>(null);
  const [crtFullHasFrame, setCrtFullHasFrame] = useState(false);
  const [crtShaderReady, setCrtShaderReady] = useState(false);
  const [crtShaderError, setCrtShaderError] = useState<string | null>(null);

  // Load saved UI settings (CRT + volumes)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY) || localStorage.getItem(SETTINGS_KEY_LEGACY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const crt = parsed?.crtPreset as CrtPreset | undefined;
      const sv = Number(parsed?.sfxVolume);
      const mv = Number(parsed?.musicVolume);
      const cse = !!parsed?.crtShaderEnabled;
      const csui = !!parsed?.crtShaderApplyToUi;
      const bse = parsed?.bulletShaderEnabled;
      const bp = parsed?.bulletPreset as BulletPreset | undefined;
      if (crt && ['off', 'lite', 'classic', 'vhs', 'ultra', 'royale', 'guest-advanced', 'geom-deluxe', 'lottes', 'vector-glow', 'hsm-mega-bezel-reflection'].includes(crt)) setCrtPreset(crt);
      if (!Number.isNaN(sv)) setSfxVolume(Math.max(0, Math.min(1, sv)));
      if (!Number.isNaN(mv)) setMusicVolume(Math.max(0, Math.min(1, mv)));
      setCrtShaderEnabled(!!cse);
      setCrtShaderApplyToUi(!!csui);
      if (typeof bse === 'boolean') setBulletShaderEnabled(bse);
      if (bp && ['neon-core', 'plasma-pulse', 'ion-beamlet', 'void-shot', 'overcharge'].includes(bp)) setBulletPreset(bp);
      const gq = parsed?.graphicsQuality as GraphicsQuality | undefined;
      if (gq && ['low', 'medium', 'high'].includes(gq)) setGraphicsQuality(gq);
    } catch {
      // ignore
    }
  }, []);

  // Persist UI settings
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ crtPreset, sfxVolume, musicVolume, crtShaderEnabled, crtShaderApplyToUi, bulletShaderEnabled, bulletPreset, graphicsQuality }));
    } catch {
      // ignore
    }
  }, [crtPreset, sfxVolume, musicVolume, crtShaderEnabled, crtShaderApplyToUi, bulletShaderEnabled, bulletPreset, graphicsQuality]);

    // If CRT is OFF, keep shader OFF too (avoid a confusing toggle state)
  useEffect(() => {
    if (crtPreset === 'off') {
      if (crtShaderEnabled) { setCrtShaderEnabled(false); setCrtShaderReady(false); }
      if (crtShaderApplyToUi) setCrtShaderApplyToUi(false);
    }
  }, [crtPreset]);

  // If shader is turned OFF, heavy mode must be OFF too.
  useEffect(() => {
    if (!crtShaderEnabled && crtShaderApplyToUi) setCrtShaderApplyToUi(false);
  }, [crtShaderEnabled]);

  useEffect(() => {
    setCrtFullHasFrame(false);
  }, [crtShaderApplyToUi]);

// Apply volumes to audio engine (UI-only settings)
  useEffect(() => {
    AudioService.setSfxVolume(sfxVolume);
    AudioService.setMusicVolume(musicVolume);
  }, [sfxVolume, musicVolume]);

  // UI scaling: keep the desktop layout, but scale it down on small screens (mobile).
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  const uiScale = useMemo(() => {
    const w = viewport.w;
    // Desktop/tablet keeps 1.0. Mobile scales down smoothly.
    if (w >= 720) return 1;
    const s = w / 560; // 560px ~ full-scale baseline
    return Math.max(0.72, Math.min(1, s));
  }, [viewport.w]);
  const uiWrapStyle = useMemo<CSSProperties | undefined>(() => {
    if (uiScale >= 0.999) return undefined;
    return {
      transform: `scale(${uiScale})`,
      transformOrigin: 'top left',
      width: `${100 / uiScale}%`,
      height: `${100 / uiScale}%`,
    };
  }, [uiScale]);

  const [showDevMenu, setShowDevMenu] = useState(false);
  const titleTapCount = useRef(0);
  const lastTapTime = useRef(0);

  // UI-only: helper for stagger/deck animation delays
  const animDelay = useCallback((ms: number): CSSProperties => ({ animationDelay: `${ms}ms` }), []);

  // Keep settings in refs so the game loop doesn't restart when toggling UI settings
  const crtPresetRef = useRef<CrtPreset>('off');
  const crtShaderEnabledRef = useRef(false);
  const crtShaderApplyToUiRef = useRef(false);
  const bulletShaderEnabledRef = useRef(true);
  const bulletPresetRef = useRef<BulletPreset>('neon-core');
  const graphicsQualityRef = useRef<GraphicsQuality>('medium');
  useEffect(() => { crtPresetRef.current = crtPreset; }, [crtPreset]);
  useEffect(() => { crtShaderEnabledRef.current = crtShaderEnabled; }, [crtShaderEnabled]);
  useEffect(() => { crtShaderApplyToUiRef.current = crtShaderApplyToUi; }, [crtShaderApplyToUi]);
  useEffect(() => { bulletShaderEnabledRef.current = bulletShaderEnabled; }, [bulletShaderEnabled]);
  useEffect(() => { bulletPresetRef.current = bulletPreset; }, [bulletPreset]);
  useEffect(() => { graphicsQualityRef.current = graphicsQuality; }, [graphicsQuality]);

  // Keep the 2D engine from drawing player bullets when the shader layer is enabled.
  useEffect(() => {
    if (engineRef.current) engineRef.current.renderPlayerBullets2D = !bulletShaderEnabled;
  }, [bulletShaderEnabled]);

  useEffect(() => {
    if (bulletShaderEnabled) return;
    // Reset transient bullet VFX state when disabled.
    bulletVisRef.current.clear();
    prevBulletsRef.current.clear();
    muzzleFxRef.current = [];
    impactFxRef.current = [];
    sparkFxRef.current = [];
    bulletLastTRef.current = 0;
    const st = bulletGlRef.current;
    if (st) {
      st.gl.clearColor(0, 0, 0, 0);
      st.gl.clear(st.gl.COLOR_BUFFER_BIT);
    }
  }, [bulletShaderEnabled]);


  // =========================================================
  // REAL CRT (WebGL post-process) - BETA
  // Renders the 2D game canvas into a WebGL canvas and applies a shader.
  // This does NOT change gameplay; it's purely a visual post-process.
  // =========================================================

  type CrtShaderParams = {
    curvature: number;
    scanline: number;
    mask: number;
    chroma: number;
    vignette: number;
    noise: number;
    bloom: number;
    gamma: number;
    saturation: number;
    bezel: number;
    reflect: number;
  };

  const CRT_SHADER_PRESETS: Record<CrtPreset, CrtShaderParams> = {
    off: { curvature: 0, scanline: 0, mask: 0, chroma: 0, vignette: 0, noise: 0, bloom: 0, gamma: 1.0, saturation: 1.0, bezel: 0, reflect: 0 },

    // Legacy (kept mild)
    lite: { curvature: 0.06, scanline: 0.18, mask: 0.10, chroma: 0.60, vignette: 0.35, noise: 0.030, bloom: 0.10, gamma: 1.05, saturation: 1.05, bezel: 0.05, reflect: 0.00 },
    classic: { curvature: 0.10, scanline: 0.28, mask: 0.18, chroma: 0.85, vignette: 0.46, noise: 0.040, bloom: 0.14, gamma: 1.08, saturation: 1.10, bezel: 0.08, reflect: 0.00 },
    vhs: { curvature: 0.12, scanline: 0.34, mask: 0.14, chroma: 1.35, vignette: 0.52, noise: 0.070, bloom: 0.12, gamma: 1.10, saturation: 1.14, bezel: 0.10, reflect: 0.00 },
    ultra: { curvature: 0.16, scanline: 0.40, mask: 0.24, chroma: 1.15, vignette: 0.62, noise: 0.055, bloom: 0.18, gamma: 1.12, saturation: 1.18, bezel: 0.12, reflect: 0.00 },

    // Shader-inspired names (stronger / more "real")
    royale: { curvature: 0.18, scanline: 0.42, mask: 0.28, chroma: 0.95, vignette: 0.66, noise: 0.045, bloom: 0.20, gamma: 1.14, saturation: 1.22, bezel: 0.14, reflect: 0.00 },
    'guest-advanced': { curvature: 0.14, scanline: 0.46, mask: 0.20, chroma: 1.60, vignette: 0.60, noise: 0.090, bloom: 0.12, gamma: 1.10, saturation: 1.18, bezel: 0.12, reflect: 0.00 },
    'geom-deluxe': { curvature: 0.10, scanline: 0.24, mask: 0.34, chroma: 0.65, vignette: 0.55, noise: 0.040, bloom: 0.14, gamma: 1.12, saturation: 1.15, bezel: 0.10, reflect: 0.00 },
    lottes: { curvature: 0.16, scanline: 0.50, mask: 0.30, chroma: 0.90, vignette: 0.70, noise: 0.055, bloom: 0.18, gamma: 1.18, saturation: 1.12, bezel: 0.14, reflect: 0.00 },
    'vector-glow': { curvature: 0.05, scanline: 0.10, mask: 0.06, chroma: 0.55, vignette: 0.40, noise: 0.020, bloom: 0.55, gamma: 1.05, saturation: 1.08, bezel: 0.06, reflect: 0.00 },
    'hsm-mega-bezel-reflection': { curvature: 0.20, scanline: 0.38, mask: 0.22, chroma: 0.85, vignette: 0.78, noise: 0.050, bloom: 0.20, gamma: 1.14, saturation: 1.12, bezel: 0.24, reflect: 0.40 },
  };

  // =========================================================
  // BULLET SHADER (WebGL) — a dedicated transparent pass that draws player bullets.
  // Purely visual; gameplay is unchanged.
  // =========================================================
  type BulletShaderParams = {
    core: [number, number, number];
    edge: [number, number, number];
    trail: number;   // pixels
    width: number;   // pixels
    glow: number;    // 0..2
    noise: number;   // 0..1
    flicker: number; // 0..1
    chroma: number;  // 0..2
    ghost: number;   // 0..1
    flash: number;   // 0..2
    ring: number;    // 0..2
  };

  const BULLET_SHADER_PRESETS: Record<BulletPreset, { label: string; p: BulletShaderParams }> = {
    'neon-core': {
      label: 'NEON Core (Minimal)',
      p: { core: [0.20, 1.00, 0.85], edge: [0.65, 0.35, 0.95], trail: 22, width: 4.2, glow: 0.80, noise: 0.00, flicker: 0.05, chroma: 0.00, ghost: 0.00, flash: 0.00, ring: 0.00 },
    },
    'plasma-pulse': {
      label: 'PLASMA Pulse (Minimal)',
      p: { core: [0.95, 0.30, 0.90], edge: [0.30, 0.55, 1.00], trail: 24, width: 4.4, glow: 0.86, noise: 0.00, flicker: 0.07, chroma: 0.00, ghost: 0.00, flash: 0.00, ring: 0.00 },
    },
    'ion-beamlet': {
      label: 'ION Beamlet (Minimal)',
      p: { core: [0.90, 0.95, 1.00], edge: [0.15, 0.70, 1.00], trail: 28, width: 3.8, glow: 0.74, noise: 0.00, flicker: 0.04, chroma: 0.00, ghost: 0.00, flash: 0.00, ring: 0.00 },
    },
    'void-shot': {
      label: 'VOID Shot (Minimal)',
      p: { core: [0.55, 0.00, 1.00], edge: [0.12, 0.12, 0.22], trail: 23, width: 4.6, glow: 0.88, noise: 0.00, flicker: 0.06, chroma: 0.00, ghost: 0.00, flash: 0.00, ring: 0.00 },
    },
    overcharge: {
      label: 'OVERCHARGE (Minimal)',
      p: { core: [1.00, 0.95, 0.25], edge: [1.00, 0.30, 0.30], trail: 30, width: 5.0, glow: 0.96, noise: 0.00, flicker: 0.08, chroma: 0.00, ghost: 0.00, flash: 0.00, ring: 0.00 },
    },
  };

  type CrtWebGLState = {
    gl: WebGLRenderingContext;
    program: WebGLProgram;
    vbo: WebGLBuffer;
    tex: WebGLTexture;
    // attribs
    aPos: number;
    aUv: number;
    // uniforms
    uTex: WebGLUniformLocation;
    uRes: WebGLUniformLocation;
    uTime: WebGLUniformLocation;
    uCurv: WebGLUniformLocation;
    uScan: WebGLUniformLocation;
    uMask: WebGLUniformLocation;
    uChroma: WebGLUniformLocation;
    uVig: WebGLUniformLocation;
    uNoise: WebGLUniformLocation;
    uBloom: WebGLUniformLocation;
    uGamma: WebGLUniformLocation;
    uSat: WebGLUniformLocation;
    uBezel: WebGLUniformLocation;
    uReflect: WebGLUniformLocation;
    // texture sizing
    texW: number;
    texH: number;
  };

  const crtGlRef = useRef<CrtWebGLState | null>(null);

  type BulletWebGLState = {
    gl: WebGLRenderingContext;
    program: WebGLProgram;
    vbo: WebGLBuffer;
    // attribs
    aPos: number;
    aUv: number;
    aCol: number;
    aKind: number;
    aSeed: number;
    aParam: number;
    // uniforms
    uRes: WebGLUniformLocation;
    uTime: WebGLUniformLocation;
    uCore: WebGLUniformLocation;
    uEdge: WebGLUniformLocation;
    uGlow: WebGLUniformLocation;
    uNoise: WebGLUniformLocation;
    uFlicker: WebGLUniformLocation;
    uChroma: WebGLUniformLocation;
  };

  const bulletGlRef = useRef<BulletWebGLState | null>(null);

  // Bullet visual tracking (used to spawn muzzle flashes / impacts + ghost trails)
  const bulletVisRef = useRef(new Map<any, { seed: number; x: number; y: number; vx: number; vy: number; hist: Array<{ x: number; y: number }> }>());
  const prevBulletsRef = useRef<Set<any>>(new Set());
  const muzzleFxRef = useRef<Array<{ x: number; y: number; t0: number; seed: number }>>([]);
  const impactFxRef = useRef<Array<{ x: number; y: number; t0: number; seed: number }>>([]);
  const sparkFxRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; t0: number; seed: number }>>([]);
  const bulletLastTRef = useRef(0);
  const bulletGlFailedRef = useRef(false);

  // A small offscreen canvas used to composite bullets into the CRT shader input (so bullets also get CRT'd).
  const crtGameCompositeRef = useRef<HTMLCanvasElement | null>(null);

  // ---------------------------------------------------------
  // HEAVY MODE (apply shader to UI too): DOM capture -> texture
  // ---------------------------------------------------------
  const html2cPromiseRef = useRef<Promise<any> | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureInFlightRef = useRef(false);
  const lastCaptureAtRef = useRef(0);

  const ensureHtml2Canvas = useCallback(async () => {
    if (window.html2canvas) return window.html2canvas;
    if (!html2cPromiseRef.current) {
      html2cPromiseRef.current = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.async = true;
        s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
        s.onload = () => {
          if (window.html2canvas) resolve(window.html2canvas);
          else reject(new Error('html2canvas failed to load.'));
        };
        s.onerror = () => reject(new Error('Failed to load html2canvas (network blocked).'));
        document.head.appendChild(s);
      });
    }
    return html2cPromiseRef.current!;
  }, []);

  const CRT_VS = `
    attribute vec2 aPos;
    attribute vec2 aUv;
    varying vec2 vUv;
    void main() {
      vUv = aUv;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `;

  const CRT_FS = `
    precision mediump float;
    uniform sampler2D uTex;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uCurvature;
    uniform float uScanline;
    uniform float uMask;
    uniform float uChroma;
    uniform float uVignette;
    uniform float uNoise;
    uniform float uBloom;
    uniform float uGamma;
    uniform float uSaturation;
    uniform float uBezel;
    uniform float uReflect;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233)) + uTime * 0.15) * 43758.5453);
    }

    vec2 curve(vec2 uv) {
      vec2 cc = uv * 2.0 - 1.0;
      float r2 = dot(cc, cc);
      cc *= 1.0 + uCurvature * r2;
      return (cc + 1.0) * 0.5;
    }

    vec3 sampleRGB(vec2 uv) {
      float dx = (uChroma / max(uResolution.x, 1.0)) * 2.0;
      vec3 c;
      c.r = texture2D(uTex, uv + vec2(dx, 0.0)).r;
      c.g = texture2D(uTex, uv).g;
      c.b = texture2D(uTex, uv - vec2(dx, 0.0)).b;
      return c;
    }

    vec3 blur5(vec2 uv) {
      vec2 px = vec2(1.0) / max(uResolution, vec2(1.0));
      vec3 c = sampleRGB(uv);
      c += sampleRGB(uv + vec2(px.x, 0.0));
      c += sampleRGB(uv - vec2(px.x, 0.0));
      c += sampleRGB(uv + vec2(0.0, px.y));
      c += sampleRGB(uv - vec2(0.0, px.y));
      return c / 5.0;
    }

    void main() {
      vec2 uv = curve(vUv);

      // Outside curved area -> fade to black with soft edge
      float inside = step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);
      float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
      float edgeFade = smoothstep(0.0, 0.02 + uBezel * 0.08, edgeDist);

      vec3 base = sampleRGB(uv);
      vec3 blurred = blur5(uv);
      vec3 col = mix(base, blurred, clamp(uBloom, 0.0, 1.0));

      // Scanlines
      float s = 0.5 + 0.5 * sin(uv.y * uResolution.y * 3.14159);
      col *= 1.0 - (uScanline * s);

      // Shadow mask triads (RGB)
      float tri = fract((uv.x * uResolution.x) / 3.0);
      vec3 m = vec3(1.0);
      if (tri < 0.333) m = vec3(1.0, 1.0 - uMask, 1.0 - uMask);
      else if (tri < 0.666) m = vec3(1.0 - uMask, 1.0, 1.0 - uMask);
      else m = vec3(1.0 - uMask, 1.0 - uMask, 1.0);
      col *= m;

      // Vignette
      vec2 cc = vUv * 2.0 - 1.0;
      float r2 = dot(cc, cc);
      float vig = 1.0 - smoothstep(0.18, 1.20, r2);
      col *= mix(1.0, vig, clamp(uVignette, 0.0, 1.0));

      // Bezel darkening
      float bezel = smoothstep(0.0, 0.09 + uBezel * 0.18, edgeDist);
      col *= bezel;

      // Subtle noise / grain
      float n = (rand(uv * uResolution.xy) - 0.5) * uNoise;
      col += n;

      // Reflection highlights (for "Mega Bezel Reflection")
      if (uReflect > 0.001) {
        float hl = exp(-pow((vUv.x - 0.22) * 6.5, 2.0)) * exp(-pow((vUv.y - 0.18) * 8.0, 2.0));
        float band = smoothstep(0.0, 0.12, vUv.x) * (1.0 - smoothstep(0.88, 1.0, vUv.x)) * (1.0 - smoothstep(0.62, 1.0, vUv.y));
        col += vec3(0.25, 0.28, 0.32) * uReflect * hl;
        col += vec3(0.06, 0.08, 0.10) * uReflect * band;
      }

      // Saturation & gamma
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(luma), col, clamp(uSaturation, 0.0, 2.0));
      col = pow(max(col, 0.0), vec3(1.0 / max(uGamma, 0.001)));

      col *= inside * edgeFade;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const BULLET_VS = `
    attribute vec2 aPos;
    attribute vec2 aUv;
    attribute vec4 aCol;
    attribute float aKind;
    attribute float aSeed;
    attribute float aParam;

    uniform vec2 uResolution;

    varying vec2 vUv;
    varying vec4 vCol;
    varying float vKind;
    varying float vSeed;
    varying float vParam;

    void main() {
      vec2 clip = (aPos / max(uResolution, vec2(1.0))) * 2.0 - 1.0;
      clip.y = -clip.y;
      gl_Position = vec4(clip, 0.0, 1.0);
      vUv = aUv;
      vCol = aCol;
      vKind = aKind;
      vSeed = aSeed;
      vParam = aParam;
    }
  `;

  const BULLET_FS = `
    precision mediump float;

    uniform float uTime;
    uniform vec3 uCore;
    uniform vec3 uEdge;
    uniform float uGlow;
    uniform float uNoise;
    uniform float uFlicker;
    uniform float uChroma;

    varying vec2 vUv;
    varying vec4 vCol;
    varying float vKind;
    varying float vSeed;
    varying float vParam;

    float hash(vec2 p) {
      // Deterministic-ish noise per sprite.
      return fract(sin(dot(p, vec2(127.1, 311.7)) + vSeed * 19.17) * 43758.5453123);
    }

    void main() {
      vec2 p = vUv * 2.0 - 1.0; // local quad space
      float t = uTime;
      float flick = 1.0 + uFlicker * (0.45 + 0.55 * sin(t * 18.0 + vSeed * 6.283));

      // 0 = bullet, 1 = muzzle flash, 2 = impact ring
      if (vKind < 0.5) {
        // Bullet capsule-ish glow.
        float along = clamp((p.x + 1.0) * 0.5, 0.0, 1.0);
        float w = mix(1.75, 1.10, along);
        float r = length(vec2(p.x * 0.85, p.y * w));

        float core = exp(-r * r * 6.2) * (0.55 + 0.85 * along);
        float halo = exp(-r * r * 2.2) * uGlow * (0.25 + 0.75 * along);
        float bloom = exp(-r * r * 1.15) * uGlow * 0.35;

        float n = (hash(p * 22.0 + vec2(t * 0.4, t * 0.2)) - 0.5) * uNoise;
        float inten = max(0.0, core + halo + bloom + n);

        vec3 col = mix(uEdge, uCore, clamp(core * 1.6, 0.0, 1.0));
        col += vec3(uChroma * 0.06, 0.0, -uChroma * 0.06) * (p.x * 0.65 + (hash(p * 4.0) - 0.5) * 0.35);

        inten *= flick;
        if (inten < 0.004) discard;

        gl_FragColor = vec4(col * inten * vCol.rgb * vCol.a, inten * vCol.a);
        return;
      }

      if (vKind < 1.5) {
        // Muzzle flash: radial burst with subtle spikes.
        float r = length(p);
        float ang = atan(p.y, p.x);
        float spikes = 0.55 + 0.45 * abs(sin(ang * 6.0 + t * 4.0 + vSeed * 2.0));
        float glow = exp(-r * r * 8.5);
        float inten = glow * spikes * (1.0 + uGlow * 0.35) * flick;
        if (inten < 0.004) discard;

        vec3 col = mix(uCore, uEdge, 0.35) + vec3(0.10);
        col += vec3(uChroma * 0.08, 0.0, -uChroma * 0.08) * (spikes - 0.5);
        gl_FragColor = vec4(col * inten * vCol.rgb * vCol.a, inten * vCol.a);
        return;
      }

      // Impact ring
      float r = length(p);
      float radius = clamp(vParam, 0.10, 1.35);
      float w = 0.10 + 0.05 * uGlow;
      float ring = smoothstep(w, 0.0, abs(r - radius));
      float inten = ring * (0.95 + 0.25 * sin(t * 10.0 + vSeed * 4.0)) * (1.0 + uGlow * 0.15) * flick;
      if (inten < 0.004) discard;
      vec3 col = mix(uEdge, uCore, 0.55);
      gl_FragColor = vec4(col * inten * vCol.rgb * vCol.a, inten * vCol.a);
    }
  `;

  const compileShader = (gl: WebGLRenderingContext, type: number, src: string) => {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('WebGL shader compile error:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  };

  const createProgram = (gl: WebGLRenderingContext, vsSrc: string, fsSrc: string) => {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    if (!prog) return null;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('WebGL program link error:', gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog);
      return null;
    }
    return prog;
  };

  const ensureCrtGl = useCallback((): CrtWebGLState | null => {
    if (crtGlRef.current) return crtGlRef.current;
    if (!glCanvasRef.current) return null;

    const gl = glCanvasRef.current.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    }) as WebGLRenderingContext | null;

    if (!gl) return null;

    const program = createProgram(gl, CRT_VS, CRT_FS);
    if (!program) return null;

    // Fullscreen quad: (pos.xy, uv.xy)
    const vbo = gl.createBuffer();
    if (!vbo) return null;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const verts = new Float32Array([
      -1, -1,  0, 0,
       1, -1,  1, 0,
      -1,  1,  0, 1,
      -1,  1,  0, 1,
       1, -1,  1, 0,
       1,  1,  1, 1,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    const tex = gl.createTexture();
    if (!tex) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

    const aPos = gl.getAttribLocation(program, 'aPos');
    const aUv = gl.getAttribLocation(program, 'aUv');
    const must = (u: WebGLUniformLocation | null) => u as WebGLUniformLocation;

    const state: CrtWebGLState = {
      gl,
      program,
      vbo,
      tex,
      aPos,
      aUv,
      uTex: must(gl.getUniformLocation(program, 'uTex')),
      uRes: must(gl.getUniformLocation(program, 'uResolution')),
      uTime: must(gl.getUniformLocation(program, 'uTime')),
      uCurv: must(gl.getUniformLocation(program, 'uCurvature')),
      uScan: must(gl.getUniformLocation(program, 'uScanline')),
      uMask: must(gl.getUniformLocation(program, 'uMask')),
      uChroma: must(gl.getUniformLocation(program, 'uChroma')),
      uVig: must(gl.getUniformLocation(program, 'uVignette')),
      uNoise: must(gl.getUniformLocation(program, 'uNoise')),
      uBloom: must(gl.getUniformLocation(program, 'uBloom')),
      uGamma: must(gl.getUniformLocation(program, 'uGamma')),
      uSat: must(gl.getUniformLocation(program, 'uSaturation')),
      uBezel: must(gl.getUniformLocation(program, 'uBezel')),
      uReflect: must(gl.getUniformLocation(program, 'uReflect')),
      texW: 0,
      texH: 0,
    };

    crtGlRef.current = state;
    return state;
  }, []);

  const ensureBulletGl = useCallback((): BulletWebGLState | null => {
    if (bulletGlRef.current) return bulletGlRef.current;
    if (!bulletGlCanvasRef.current) return null;

    const gl = bulletGlCanvasRef.current.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    }) as WebGLRenderingContext | null;

    if (!gl) {
      if (!bulletGlFailedRef.current) {
        bulletGlFailedRef.current = true;
        setBulletShaderError('WebGL indisponível para o Bullet Shader neste dispositivo.');
        setBulletShaderEnabled(false);
      }
      return null;
    }

    const program = createProgram(gl, BULLET_VS, BULLET_FS);
    if (!program) {
      if (!bulletGlFailedRef.current) {
        bulletGlFailedRef.current = true;
        setBulletShaderError('Falha ao compilar o Bullet Shader (GLSL).');
        setBulletShaderEnabled(false);
      }
      return null;
    }

    const vbo = gl.createBuffer();
    if (!vbo) {
      if (!bulletGlFailedRef.current) {
        bulletGlFailedRef.current = true;
        setBulletShaderError('Falha ao inicializar buffers do Bullet Shader.');
        setBulletShaderEnabled(false);
      }
      return null;
    }

    const must = (u: WebGLUniformLocation | null) => u as WebGLUniformLocation;

    const st: BulletWebGLState = {
      gl,
      program,
      vbo,
      aPos: gl.getAttribLocation(program, 'aPos'),
      aUv: gl.getAttribLocation(program, 'aUv'),
      aCol: gl.getAttribLocation(program, 'aCol'),
      aKind: gl.getAttribLocation(program, 'aKind'),
      aSeed: gl.getAttribLocation(program, 'aSeed'),
      aParam: gl.getAttribLocation(program, 'aParam'),
      uRes: must(gl.getUniformLocation(program, 'uResolution')),
      uTime: must(gl.getUniformLocation(program, 'uTime')),
      uCore: must(gl.getUniformLocation(program, 'uCore')),
      uEdge: must(gl.getUniformLocation(program, 'uEdge')),
      uGlow: must(gl.getUniformLocation(program, 'uGlow')),
      uNoise: must(gl.getUniformLocation(program, 'uNoise')),
      uFlicker: must(gl.getUniformLocation(program, 'uFlicker')),
      uChroma: must(gl.getUniformLocation(program, 'uChroma')),
    };

    // Fixed render state for an additive, transparent glow pass.
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    bulletGlRef.current = st;
    return st;
  }, [setBulletShaderEnabled, setBulletShaderError]);

  const drawBulletShaderFrame = useCallback((nowMs: number) => {
    if (!bulletShaderEnabledRef.current) return;
    const engine = engineRef.current;
    const src = canvasRef.current;
    const out = bulletGlCanvasRef.current;
    if (!engine || !src || !out) return;

    const st = ensureBulletGl();
    if (!st) return;

    // Match the game canvas size.
    if (out.width !== src.width || out.height !== src.height) {
      out.width = src.width;
      out.height = src.height;
    }

    const last = bulletLastTRef.current || nowMs;
    const dt = Math.max(0, Math.min(0.05, (nowMs - last) / 1000));
    bulletLastTRef.current = nowMs;

    const presetKey = bulletPresetRef.current;
    const preset = (BULLET_SHADER_PRESETS[presetKey] || BULLET_SHADER_PRESETS['neon-core']).p;

    const enableFlash = preset.flash > 0.01;
    const enableRing = preset.ring > 0.01;
    const enableSparks = enableFlash || enableRing;
    const enableGhost = preset.ghost > 0.01;

    // ------------------------------------------------------
    // Track bullets to spawn muzzle flashes + impact rings.
    // ------------------------------------------------------
    const vis = bulletVisRef.current;
    const prev = prevBulletsRef.current;
    const curr = new Set<any>();

    for (const b of engine.bullets) {
      curr.add(b);
      let v = vis.get(b);
      if (!v) {
        const seed = Math.random();
        v = { seed, x: b.x, y: b.y, vx: b.vx, vy: b.vy, hist: [] };
        vis.set(b, v);

        // Minimal mode: only spawn extras if the preset enables them.
        if (enableFlash) {
          muzzleFxRef.current.push({ x: b.x, y: b.y, t0: nowMs, seed });
        }
        if (enableSparks) {
          for (let i = 0; i < 3; i++) {
            const ang = Math.random() * Math.PI * 2;
            const sp = 140 + Math.random() * 160;
            sparkFxRef.current.push({ x: b.x, y: b.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, t0: nowMs, seed: Math.random() });
          }
        }
      }

      v.vx = b.vx;
      v.vy = b.vy;
      v.x = b.x;
      v.y = b.y;
      if (enableGhost) {
        v.hist.push({ x: b.x, y: b.y });
        if (v.hist.length > 4) v.hist.shift();
      }
    }

    // Removed bullets => impact
    for (const b of prev) {
      if (!curr.has(b)) {
        const v = vis.get(b);
        if (v) {
          if (enableRing) {
            impactFxRef.current.push({ x: v.x, y: v.y, t0: nowMs, seed: v.seed });
          }
          if (enableSparks) {
            for (let i = 0; i < 4; i++) {
              const ang = Math.random() * Math.PI * 2;
              const sp = 180 + Math.random() * 220;
              sparkFxRef.current.push({ x: v.x, y: v.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, t0: nowMs, seed: Math.random() });
            }
          }
        }
        vis.delete(b);
      }
    }
    prevBulletsRef.current = curr;

    // Update + cull FX lists (only if enabled by preset)
    muzzleFxRef.current = enableFlash ? muzzleFxRef.current.filter(f => nowMs - f.t0 < 120) : [];
    impactFxRef.current = enableRing ? impactFxRef.current.filter(f => nowMs - f.t0 < 220) : [];

    // Sparks move with drag (optional)
    if (enableSparks && sparkFxRef.current.length) {
      const sparks = sparkFxRef.current;
      for (const s of sparks) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vx *= Math.pow(0.10, dt); // strong drag
        s.vy *= Math.pow(0.10, dt);
      }
      sparkFxRef.current = sparks.filter(s => nowMs - s.t0 < 160);
    } else {
      sparkFxRef.current = [];
    }

    // ------------------------------------------------------
    // Build geometry: bullets + ghosts + muzzle + impacts.
    // Layout per-vertex: pos(2), uv(2), col(4), kind(1), seed(1), param(1)
    // ------------------------------------------------------
    const verts: number[] = [];
    const pushVert = (x: number, y: number, u: number, v: number, r: number, g: number, b: number, a: number, kind: number, seed: number, param: number) => {
      verts.push(x, y, u, v, r, g, b, a, kind, seed, param);
    };
    const pushQuad = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number, r: number, g: number, b: number, a: number, kind: number, seed: number, param: number) => {
      // tri 1
      pushVert(x1, y1, 0, 0, r, g, b, a, kind, seed, param);
      pushVert(x2, y2, 0, 1, r, g, b, a, kind, seed, param);
      pushVert(x3, y3, 1, 1, r, g, b, a, kind, seed, param);
      // tri 2
      pushVert(x1, y1, 0, 0, r, g, b, a, kind, seed, param);
      pushVert(x3, y3, 1, 1, r, g, b, a, kind, seed, param);
      pushVert(x4, y4, 1, 0, r, g, b, a, kind, seed, param);
    };

    const drawBeam = (cx: number, cy: number, vx: number, vy: number, baseTrail: number, baseW: number, a: number, seed: number, extraLen = 0) => {
      const sp = Math.hypot(vx, vy);
      let dx = vx, dy = vy;
      if (sp < 0.001) { dx = 1; dy = 0; } else { dx /= sp; dy /= sp; }
      const px = -dy;
      const py = dx;

      const trail = baseTrail * (0.65 + Math.min(2.0, sp * 0.06)) + extraLen;
      const head = 6 + Math.min(14, sp * 0.08);

      const hx = cx + dx * head;
      const hy = cy + dy * head;
      const tx = cx - dx * trail;
      const ty = cy - dy * trail;
      const w = baseW * (0.95 + Math.min(0.9, sp * 0.02));

      const x1 = tx - px * w;
      const y1 = ty - py * w;
      const x2 = tx + px * w;
      const y2 = ty + py * w;
      const x3 = hx + px * w;
      const y3 = hy + py * w;
      const x4 = hx - px * w;
      const y4 = hy - py * w;

      pushQuad(x1, y1, x2, y2, x3, y3, x4, y4, 0.85, 0.85, 0.85, a, 0, seed, 0);
    };

    // Player bullets (main + ghosts)
    for (const b of engine.bullets) {
      const v = vis.get(b);
      if (!v) continue;
      drawBeam(b.x, b.y, b.vx, b.vy, preset.trail, preset.width, 0.60, v.seed);

      // Ghost trail: draw 2 older samples with lower alpha/shorter trail
      const h = v.hist;
      if (preset.ghost > 0.01 && h.length >= 3) {
        const g1 = h[Math.max(0, h.length - 3)];
        const g2 = h[Math.max(0, h.length - 4)];
        drawBeam(g1.x, g1.y, b.vx, b.vy, preset.trail * 0.60, preset.width * 0.92, 0.35 * preset.ghost, v.seed + 0.11, 6);
        drawBeam(g2.x, g2.y, b.vx, b.vy, preset.trail * 0.45, preset.width * 0.85, 0.22 * preset.ghost, v.seed + 0.27, 10);
      }
    }

    // Sparks
    if (enableSparks) {
      for (const s of sparkFxRef.current) {
      const age = (nowMs - s.t0) / 160;
      const a = Math.max(0, 1 - age);
      if (a <= 0) continue;
      drawBeam(s.x, s.y, s.vx, s.vy, preset.trail * 0.20, preset.width * 0.55, 0.25 * a, s.seed + 0.5, 0);
    }
    }

    // Muzzle flashes
    if (enableFlash) {
      for (const f of muzzleFxRef.current) {
      const age = (nowMs - f.t0) / 120;
      const a = Math.max(0, 1 - age);
      if (a <= 0) continue;
      const size = 38 + 26 * (1 - age);
      const x1 = f.x - size; const y1 = f.y - size;
      const x2 = f.x - size; const y2 = f.y + size;
      const x3 = f.x + size; const y3 = f.y + size;
      const x4 = f.x + size; const y4 = f.y - size;
      pushQuad(x1, y1, x2, y2, x3, y3, x4, y4, 1, 1, 1, 0.65 * a * preset.flash, 1, f.seed + 0.2, 0);
    }
    }

    // Impact rings
    if (enableRing) {
      for (const f of impactFxRef.current) {
      const age = (nowMs - f.t0) / 220;
      const a = Math.max(0, 1 - age);
      if (a <= 0) continue;
      const size = 46 + 72 * age;
      const radius = 0.20 + 1.05 * age;
      const x1 = f.x - size; const y1 = f.y - size;
      const x2 = f.x - size; const y2 = f.y + size;
      const x3 = f.x + size; const y3 = f.y + size;
      const x4 = f.x + size; const y4 = f.y - size;
      pushQuad(x1, y1, x2, y2, x3, y3, x4, y4, 1, 1, 1, 0.55 * a * preset.ring, 2, f.seed + 0.9, radius);
    }
    }

    const { gl } = st;
    gl.viewport(0, 0, out.width, out.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (verts.length === 0) return;

    gl.useProgram(st.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, st.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);

    const stride = 11 * 4;
    gl.enableVertexAttribArray(st.aPos);
    gl.vertexAttribPointer(st.aPos, 2, gl.FLOAT, false, stride, 0);

    gl.enableVertexAttribArray(st.aUv);
    gl.vertexAttribPointer(st.aUv, 2, gl.FLOAT, false, stride, 2 * 4);

    gl.enableVertexAttribArray(st.aCol);
    gl.vertexAttribPointer(st.aCol, 4, gl.FLOAT, false, stride, 4 * 4);

    gl.enableVertexAttribArray(st.aKind);
    gl.vertexAttribPointer(st.aKind, 1, gl.FLOAT, false, stride, 8 * 4);

    gl.enableVertexAttribArray(st.aSeed);
    gl.vertexAttribPointer(st.aSeed, 1, gl.FLOAT, false, stride, 9 * 4);

    gl.enableVertexAttribArray(st.aParam);
    gl.vertexAttribPointer(st.aParam, 1, gl.FLOAT, false, stride, 10 * 4);

    gl.uniform2f(st.uRes, out.width, out.height);
    gl.uniform1f(st.uTime, nowMs / 1000);
    gl.uniform3f(st.uCore, preset.core[0], preset.core[1], preset.core[2]);
    gl.uniform3f(st.uEdge, preset.edge[0], preset.edge[1], preset.edge[2]);
    gl.uniform1f(st.uGlow, preset.glow);
    gl.uniform1f(st.uNoise, preset.noise);
    gl.uniform1f(st.uFlicker, preset.flicker);
    gl.uniform1f(st.uChroma, preset.chroma);

    // Additive blending for neon glow.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    gl.drawArrays(gl.TRIANGLES, 0, verts.length / 11);
  }, [ensureBulletGl]);
  // Capture the UI layer and composite it over the game canvas (HEAVY).
  // This avoids cases where the WebGL canvas sits above the UI and the capture misses UI layers.
  // Intentionally heavy and can reduce FPS.
  const scheduleFullCapture = useCallback((nowMs: number) => {
    if (!crtShaderEnabledRef.current) return;
    if (!crtShaderApplyToUiRef.current) return;
    if (crtPresetRef.current === 'off') return;

    const root = captureRootRef.current;
    const uiLayer = uiLayerRef.current;
    const h2c = window.html2canvas;
    if (!uiLayer || !h2c) return;

    // Throttle captures (the shader will reuse the last captured frame).
    const intervalMs = 1000 / 15; // 15 FPS capture
    if (nowMs - lastCaptureAtRef.current < intervalMs) return;
    if (captureInFlightRef.current) return;

    captureInFlightRef.current = true;
    lastCaptureAtRef.current = nowMs;

    // HEAVY mode is already expensive; keep scale at 1 for reliable UI capture.
    // (The game canvas itself is already 1:1 with CSS pixels in this project.)
    const scale = 1;

    h2c(uiLayer, {
      backgroundColor: null,
      scale,
      logging: false,
      useCORS: true,
      allowTaint: true,
      // Extra safety: ignore any node marked as html2canvas-ignore.
      ignoreElements: (el: Element) => (el as HTMLElement).dataset?.html2canvasIgnore === 'true',
    })
      .then((uiCanvas: HTMLCanvasElement) => {
        const game = canvasRef.current;
        const w = game?.width || root?.clientWidth || Math.floor(window.innerWidth);
        const h = game?.height || root?.clientHeight || Math.floor(window.innerHeight);

        let comp = compositeCanvasRef.current;
        if (!comp) {
          comp = document.createElement('canvas');
          compositeCanvasRef.current = comp;
        }
        if (comp.width !== w || comp.height !== h) {
          comp.width = w;
          comp.height = h;
        }
        const ctx = comp.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, w, h);
        if (game) {
          ctx.drawImage(game, 0, 0, w, h);
        } else {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, w, h);
        }

        // Composite the bullet shader pass UNDER the UI (so bullets are CRT-processed too).
        if (bulletShaderEnabledRef.current && bulletGlCanvasRef.current) {
          ctx.drawImage(bulletGlCanvasRef.current, 0, 0, w, h);
        }

        // Draw the captured UI over the game.
        ctx.drawImage(uiCanvas, 0, 0, w, h);

        captureCanvasRef.current = comp;
        setCrtFullHasFrame(true);
      })
      .catch((e: any) => {
        console.warn('UI capture failed:', e);
        setCrtShaderError(String(e?.message || e || 'UI capture failed.'));
        setCrtShaderApplyToUi(false);
      })
      .finally(() => {
        captureInFlightRef.current = false;
      });
  }, []);

  const drawCrtShader = useCallback((timeMs: number) => {
    const preset = crtPresetRef.current;
    const enabled = crtShaderEnabledRef.current;
    const full = crtShaderApplyToUiRef.current;
    const src = canvasRef.current;
    const dst = glCanvasRef.current;

    if (!enabled || preset === 'off' || !dst) return;

    // In heavy mode, we render the last captured DOM frame.
    let input = full ? captureCanvasRef.current : src;
    if (!input) return;

    // If the bullet shader is enabled, composite its WebGL pass into the CRT input
    // (game-only mode). In full mode the composite already includes bullets.
    if (!full && bulletShaderEnabledRef.current && bulletGlCanvasRef.current && src) {
      let comp = crtGameCompositeRef.current;
      if (!comp) {
        comp = document.createElement('canvas');
        crtGameCompositeRef.current = comp;
      }
      if (comp.width !== src.width || comp.height !== src.height) {
        comp.width = src.width;
        comp.height = src.height;
      }
      const ctx = comp.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, comp.width, comp.height);
        ctx.drawImage(src, 0, 0, comp.width, comp.height);
        ctx.drawImage(bulletGlCanvasRef.current, 0, 0, comp.width, comp.height);
        input = comp;
      }
    }

    const st = ensureCrtGl();
    if (!st) return;

    const gl = st.gl;
    // Output size
    const outW = src ? src.width : Math.floor(window.innerWidth);
    const outH = src ? src.height : Math.floor(window.innerHeight);
    if (dst.width !== outW || dst.height !== outH) {
      dst.width = outW;
      dst.height = outH;
      gl.viewport(0, 0, dst.width, dst.height);
    }

    gl.useProgram(st.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, st.vbo);

    gl.enableVertexAttribArray(st.aPos);
    gl.vertexAttribPointer(st.aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(st.aUv);
    gl.vertexAttribPointer(st.aUv, 2, gl.FLOAT, false, 16, 8);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, st.tex);

    try {
      // Upload the input canvas into a texture
      if (st.texW !== input.width || st.texH !== input.height) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, input);
        st.texW = input.width;
        st.texH = input.height;
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, input);
      }
    } catch (e) {
      // If upload fails for any reason, bail silently.
      return;
    }

    const p = CRT_SHADER_PRESETS[preset];

    gl.uniform1i(st.uTex, 0);
    gl.uniform2f(st.uRes, dst.width, dst.height);
    gl.uniform1f(st.uTime, timeMs / 1000);
    gl.uniform1f(st.uCurv, p.curvature);
    gl.uniform1f(st.uScan, p.scanline);
    gl.uniform1f(st.uMask, p.mask);
    gl.uniform1f(st.uChroma, p.chroma);
    gl.uniform1f(st.uVig, p.vignette);
    gl.uniform1f(st.uNoise, p.noise);
    gl.uniform1f(st.uBloom, p.bloom);
    gl.uniform1f(st.uGamma, p.gamma);
    gl.uniform1f(st.uSat, p.saturation);
    gl.uniform1f(st.uBezel, p.bezel);
    gl.uniform1f(st.uReflect, p.reflect);

    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }, [ensureCrtGl]);

  // Keep the shader pipeline in sync with the toggle (prevents black screen if WebGL is unavailable)
  useEffect(() => {
    if (!crtShaderEnabled || crtPreset === 'off') {
      setCrtShaderReady(false);
      return;
    }
    const st = ensureCrtGl();
    if (st) {
      // Heavy mode needs html2canvas too.
      if (crtShaderApplyToUi) {
        ensureHtml2Canvas()
          .then(() => {
            setCrtShaderReady(true);
            setCrtShaderError(null);
          })
          .catch((e: any) => {
            // Fall back to game-only shader if capture lib can't load.
            setCrtShaderApplyToUi(false);
            setCrtShaderReady(true);
            setCrtShaderError(String(e?.message || e || 'Failed to enable UI capture.'));
          });
      } else {
        setCrtShaderReady(true);
        setCrtShaderError(null);
      }
    } else {
      setCrtShaderReady(false);
      setCrtShaderEnabled(false);
      setCrtShaderError('WebGL not available on this device/browser.');
    }
  }, [crtShaderEnabled, crtPreset, crtShaderApplyToUi, ensureCrtGl, ensureHtml2Canvas]);
  
  const rafIdRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const lastUiCommitRef = useRef<number>(0); // throttle React UI commits for smoother animations

  const refreshSave = () => setSavedData(PersistenceService.load());

  const getPermanentUpgradeCost = (baseCost: number, mult: number, level: number) => {
    return Math.round(baseCost * Math.pow(mult, level));
  };

  const buyPermanentUpgrade = (key: PermanentUpgradeKey, baseCost: number, mult: number, level: number, maxLevel: number) => {
    if (level >= maxLevel) return;
    const cost = getPermanentUpgradeCost(baseCost, mult, level);
    const ok = PersistenceService.buyPermanentUpgrade(key as any, cost);
    if (ok) refreshSave();
  };


  const pauseGame = useCallback(() => {
    if (!engineRef.current || engineRef.current.gameState !== GameState.PLAYING) return;
    engineRef.current.gameState = GameState.PAUSED;
    engineRef.current.keys.clear();
    engineRef.current.joystick.active = false;
    setGameState(GameState.PAUSED);
  }, []);

  const resumeGame = useCallback(() => {
    if (!engineRef.current || engineRef.current.gameState !== GameState.PAUSED) return;
    engineRef.current.gameState = GameState.PLAYING;
    setGameState(GameState.PLAYING);
    setStats({ ...engineRef.current.stats });
    lastTimeRef.current = performance.now();
    AudioService.unlock();
  }, []);

  const restartRun = useCallback(() => {
    if (!engineRef.current) return;
    const save = PersistenceService.load();
    const skin = SKINS.find(s => s.id === save.selectedSkin) || SKINS[0];
    engineRef.current.start(false);
    engineRef.current.applyPermanentBonuses(save.permanentUpgrades, skin.color);
    setGameState(GameState.PLAYING);
    setStats({ ...engineRef.current.stats });
    lastTimeRef.current = performance.now();
    AudioService.unlock();
    if (canvasRef.current) canvasRef.current.focus();
  }, []);

  const backToMainMenu = useCallback(() => {
    if (!engineRef.current) return;
    engineRef.current.start(true);
    setMenuScreen('MAIN');
    setGameState(GameState.MENU);
  }, []);

  const initRun = () => {
    if (!engineRef.current) return;
    const save = PersistenceService.load();
    const skin = SKINS.find(s => s.id === save.selectedSkin) || SKINS[0];
    engineRef.current.start(false);
    engineRef.current.applyPermanentBonuses(save.permanentUpgrades, skin.color);
    setGameState(GameState.PLAYING);
    lastTimeRef.current = performance.now();
    AudioService.unlock();
    if (canvasRef.current) canvasRef.current.focus();
  };

  const handleLevelUp = useCallback(() => {
    let available = UPGRADES;
    if (engineRef.current) {
      const s = engineRef.current.stats;
      available = UPGRADES.filter(u => {
        if (u.id === 'ms' && s.multiShot >= 6) return false;
        if (u.id === 'spray' && s.hasSpray) return false;
        if (u.id === 'sniper' && s.hasSniper) return false;
        if (u.id === 'glass_cannon' && s.hasGlassCannon) return false;
        if (u.id === 'tank' && s.hasTank) return false;
        if (u.id === 'drone' && s.droneLevel >= 10) return false;
        if (u.id === 'fear' && s.fearLevel >= 10) return false;
        if (u.id === 'freeze' && s.freezeLevel >= 10) return false;
        if (u.id === 'aura' && s.auraLevel >= 10) return false;
        if (u.id === 'pulse' && s.pulseLevel >= 10) return false;
        if (u.id === 'xp_gain' && s.xpGainLevel >= 12) return false;
        if (u.id === 'orb_affinity' && s.realOrbAffinity >= 2) return false;
        if (u.id === 'extra_orb' && s.extraOrbChanceLevel >= 10) return false;
        if (u.id === 'magnet_plus' && s.magnetLevel >= 12) return false;
        if (u.id === 'pull_speed' && s.pullSpeedLevel >= 10) return false;
        if (u.id === 'credits_plus' && s.creditsLevel >= 10) return false;
        if (u.id === 'speed_plus' && s.speedLevel >= 12) return false;
        if (u.id === 'dash_unlock' && s.hasDash) return false;
        if (u.id === 'dash_cd' && s.dashCdLevel >= 10) return false;
        if (u.id === 'handling' && s.handlingLevel >= 10) return false;
        if (u.id === 'hitbox_reduction' && s.hitboxLevel >= 8) return false;
        if (u.id === 'hp_plus' && s.hpPlusLevel >= 18) return false;
        if (u.id === 'regen' && s.regenLevel >= 10) return false;
        if (u.id === 'armor' && s.armorLevel >= 10) return false;
        if (u.id === 'shield' && s.shieldLevel >= 10) return false;
        if (u.id === 'iframes' && s.iFrameLevel >= 6) return false;
        if (u.id === 'bullet_resist' && s.bulletResistLevel >= 10) return false;
        if (u.id === 'heal_kill' && s.healOnKillLevel >= 10) return false;
        if (u.id === 'knockback_plus' && s.knockbackLevel >= 10) return false;
        if (u.id === 'slow_shot' && s.slowLevel >= 10) return false;
        if (u.id === 'burn_shot' && s.burnLevel >= 10) return false;
        if (u.id === 'gauss' && (s as any).gaussLevel >= 8) return false;
        if (u.id === 'dash_cd' && !s.hasDash) return false;
        return true;
      });
    }
    const shuffled = [...available].sort(() => 0.5 - Math.random());
    setRandomUpgrades(shuffled.slice(0, 3));
    AudioService.playLevelUpSfx();
    setGameState(GameState.LEVEL_UP);
  }, []);

  const handleGameOver = useCallback((coins: number) => {
    PersistenceService.addCoins(coins);
    refreshSave();
    setGameState(GameState.GAME_OVER);
  }, []);

  const selectUpgrade = useCallback((upgrade: Upgrade) => {
    if (engineRef.current) {
      engineRef.current.stats = upgrade.apply(engineRef.current.stats);
      engineRef.current.gameState = GameState.PLAYING;
      setGameState(GameState.PLAYING);
      setStats({ ...engineRef.current.stats });
      lastTimeRef.current = performance.now();
    }
  }, []);

  const toggleSfx = () => {
    const newVal = PersistenceService.toggleSfx();
    AudioService.setEnabled(newVal);
    refreshSave();
    if (newVal) AudioService.unlock();
  };

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
      });
      setIsFullScreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
        setIsFullScreen(false);
      }
    }
  };

  useEffect(() => {
    const onFullScreenChange = () => {
      setIsFullScreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onFullScreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullScreenChange);
  }, []);

  useEffect(() => {
    AudioService.init(savedData.sfxEnabled);
    if (!canvasRef.current) return;
    const engine = new GameEngine(canvasRef.current, handleLevelUp, handleGameOver);
    engineRef.current = engine;
    engine.renderPlayerBullets2D = !bulletShaderEnabledRef.current;
    engine.start(true);
const computeDpr = () => {
  const raw = window.devicePixelRatio || 1;
  const cap = graphicsQualityRef.current === 'low' ? 1 : (graphicsQualityRef.current === 'high' ? 2 : 1.5);
  return Math.min(raw, cap);
};
const handleResize = () => {
  engine.setGraphicsQuality(graphicsQualityRef.current);
  engine.resize(window.innerWidth, window.innerHeight, computeDpr());
};
    window.addEventListener('resize', handleResize);
    handleResize();
    lastTimeRef.current = performance.now();
    const loop = (currentTime: number) => {
      let dt = (currentTime - lastTimeRef.current) / 1000;
      lastTimeRef.current = currentTime;
      dt = Math.min(dt, 0.033); 
      if (engine.gameState === GameState.PLAYING || engine.gameState === GameState.PAUSED || engine.isDemo) {
        engine.update(dt);
        engine.draw();
        // Bullet WebGL glow pass (renders ONLY player bullets)
        drawBulletShaderFrame(currentTime);
        // Heavy mode: capture DOM+UI (throttled) so the shader can process the whole screen.
        scheduleFullCapture(currentTime);
        // Post-process the rendered frame (if enabled)
        drawCrtShader(currentTime);
        if (engine.gameState === GameState.PLAYING) {
          // Throttle React state updates so CSS animations stay smooth under load.
          const UI_COMMIT_INTERVAL_MS = 1000 / 30; // 30fps UI updates
          if (currentTime - lastUiCommitRef.current >= UI_COMMIT_INTERVAL_MS) {
            lastUiCommitRef.current = currentTime;
            setStats({ ...engine.stats });
            setRound(engine.round);
            if (engine.stats.hasDash) {
              const reduction = engine.stats.dashCdLevel * 0.08;
              const maxCd = Math.max(1.2, 3.0 * (1 - reduction));
              setDashCdPercent(Math.max(0, engine.dashCooldown / maxCd));
            }
          }
        } else if (engine.isDemo) {
          if(Math.random() < 0.02) engine.particles.emit(Math.random()*engine.canvas.width, Math.random()*engine.canvas.height, '#7c3aed', 1);
        }
      }
      rafIdRef.current = requestAnimationFrame(loop);
    };
    rafIdRef.current = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [handleLevelUp, handleGameOver, savedData.sfxEnabled, drawCrtShader, scheduleFullCapture, drawBulletShaderFrame]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!engineRef.current) return;
      if (!engineRef.current.isDemo) engineRef.current.keys.add(e.key);
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        if (engineRef.current.gameState === GameState.PLAYING) pauseGame();
        else if (engineRef.current.gameState === GameState.PAUSED) resumeGame();
      }
      if (e.shiftKey && e.code === 'KeyD') setShowDevMenu(prev => !prev);
    };
    const up = (e: KeyboardEvent) => engineRef.current?.keys.delete(e.key);
    const blur = () => engineRef.current?.keys.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [pauseGame, resumeGame]);

  const buyOrEquipSkin = (skinId: string, price: number) => {
    if (savedData.unlockedSkins.includes(skinId)) { PersistenceService.setSelectedSkin(skinId); refreshSave(); }
    else if (PersistenceService.spendCoins(price)) { PersistenceService.unlockSkin(skinId); PersistenceService.setSelectedSkin(skinId); refreshSave(); }
  };


  const onUiClickCapture = useCallback((e: any) => {
    const target = e?.target as HTMLElement | null;
    if (!target) return;
    // Only play for UI buttons (avoid canvas drag / joystick etc.)
    const btn = target.closest?.('button');
    if (!btn) return;
    AudioService.unlock();
    AudioService.startMusic();
    AudioService.playUiClickSfx();
  }, []);
// apply graphics quality without restarting the engine
useEffect(() => {
  const e = engineRef.current;
  if (!e) return;
  const raw = window.devicePixelRatio || 1;
  const cap = graphicsQuality === 'low' ? 1 : (graphicsQuality === 'high' ? 2 : 1.5);
  const dpr = Math.min(raw, cap);
  e.setGraphicsQuality(graphicsQuality);
  e.resize(window.innerWidth, window.innerHeight, dpr);
}, [graphicsQuality]);


  const crtRootClass = useMemo(() => (crtPreset === 'off' ? '' : `crt-mode-${crtPreset}`), [crtPreset]);
  const shaderActive = crtShaderEnabled && crtPreset !== 'off' && crtShaderReady;
  const fullShaderActive = shaderActive && crtShaderApplyToUi;
  const gameOnlyShaderActive = shaderActive && !crtShaderApplyToUi;

  return (
    <div ref={captureRootRef} onClickCapture={onUiClickCapture} className={`relative w-full h-screen overflow-hidden font-sans text-white z-10 crt-root ${crtRootClass} ${crtPreset !== 'off' ? 'crt-enabled' : ''} ${bulletShaderEnabled ? 'bullet-shader-on' : ''} ${shaderActive ? 'crt-gl-enabled crt-shader-on' : ''} ${fullShaderActive ? `crt-full-on ${crtFullHasFrame ? 'crt-full-has-frame' : ''}` : ''} ${gameOnlyShaderActive ? 'crt-gl-game' : ''}`}
      onTouchStart={(e) => {
        AudioService.unlock();
        if (!engineRef.current || engineRef.current.gameState !== GameState.PLAYING || showDevMenu || engineRef.current.isDemo) return;
        // Don't start joystick when tapping UI buttons (pause/dash/etc.)
        const target = e.target as HTMLElement | null;
        if (target?.closest?.('button')) return;
        const touch = e.touches[0];
        engineRef.current.joystick = { active: true, base: { x: touch.clientX, y: touch.clientY }, current: { x: touch.clientX, y: touch.clientY } };
      }}
      onMouseDown={() => AudioService.unlock()}
      onTouchMove={(e) => {
        if (engineRef.current?.joystick.active && !engineRef.current.isDemo) {
          const touch = e.touches[0];
          engineRef.current.joystick.current = { x: touch.clientX, y: touch.clientY };
        }
      }}
      onTouchEnd={() => { if (engineRef.current) engineRef.current.joystick.active = false; }}
      onTouchCancel={() => { if (engineRef.current) engineRef.current.joystick.active = false; }}
    >
            {gameState === GameState.MENU && (
        <div className="menu-scroll-bg" aria-hidden="true">
          <div className="menu-scroll-bg__img menu-scroll-bg__img--a"></div>
</div>
      )}

<canvas ref={canvasRef} className={`absolute inset-0 outline-none crt-source-canvas ${gameState === GameState.MENU ? 'opacity-0' : 'opacity-100'}`} tabIndex={0}  style={{ imageRendering: 'pixelated' }} />
      <canvas ref={bulletGlCanvasRef} className={`absolute inset-0 pointer-events-none bullet-gl-canvas ${gameState === GameState.MENU ? 'opacity-0' : 'opacity-100'}`} aria-hidden="true" data-html2canvas-ignore="true" />
      <canvas ref={glCanvasRef} className={`absolute inset-0 pointer-events-none crt-gl-canvas ${gameState === GameState.MENU ? 'opacity-0' : 'opacity-100'}`} aria-hidden="true" data-html2canvas-ignore="true" />

      {/* UI layer (scaled on mobile to match desktop layout, but more compact) */}
      <div ref={uiLayerRef} className="absolute inset-0 crt-ui-layer" style={uiWrapStyle}>

      {gameState === GameState.MENU && (
        <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-4">
          {/* Settings (top-left) */}
          <div className="absolute top-4 left-4 sm:top-8 sm:left-8 z-50">
            <button
              onClick={() => setSettingsOpen(true)}
              className="p-2 sm:p-4 rounded-full glass-button transition-all text-white border-white/25"
              aria-label="Open Settings"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="h-6 w-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            </button>
          </div>

          {/* Settings Drawer */}
          <div className={`settings-backdrop ${settingsOpen ? 'open' : ''}`} onClick={() => setSettingsOpen(false)} />
          <div className={`settings-drawer ${settingsOpen ? 'open' : ''}`} onClick={(e) => e.stopPropagation()}>
            <div className="premium-card ui-panel p-5 sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-white font-black text-xl sm:text-2xl italic uppercase tracking-tighter">Settings</div>
                  <div className="text-zinc-500 text-[10px] font-bold uppercase tracking-[0.35em] mt-1">Visual / Audio</div>
                </div>
                <button
                  onClick={() => setSettingsOpen(false)}
                  className="p-2 rounded-xl glass-button bg-white/5 border-white/10 hover:bg-white/10"
                  aria-label="Close Settings"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                </button>
              </div>

              <div className="mt-6 space-y-6">
                <div className="p-4 bg-black/25 rounded-2xl border border-white/10">
                  <div className="text-white/80 text-[10px] uppercase font-black tracking-[0.2em]">Display</div>
                  <div className="mt-3">
                    <div className="text-zinc-400 text-xs font-bold uppercase tracking-widest">Qualidade Gráfica</div>
<select
  value={graphicsQuality}
  onChange={(e) => setGraphicsQuality(e.target.value as GraphicsQuality)}
  className="mt-2 w-full px-4 py-3 rounded-2xl glass-input text-white bg-black/40 border border-white/10 outline-none"
>
  <option value="low">Baixo (mais FPS)</option>
  <option value="medium">Médio (recomendado)</option>
  <option value="high">Alto (mais nítido)</option>
</select>
<div className="mt-2 text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Ajusta nitidez (DPR) e partículas. Alto pode pesar no celular.</div>

<div className="text-zinc-400 text-xs font-bold uppercase tracking-widest">CRT Filter</div>
                    <select
                      value={crtPreset}
                      onChange={(e) => setCrtPreset(e.target.value as CrtPreset)}
                      className="mt-2 w-full px-4 py-3 rounded-2xl glass-input text-white bg-black/40 border border-white/10 outline-none"
                    >
                      <option value="off">OFF</option>
                      <optgroup label="New">
                        <option value="royale">CRT-Royale (Kurozumi Edition)</option>
                        <option value="guest-advanced">CRT-Guest-Advanced (Dr-Venom)</option>
                        <option value="geom-deluxe">CRT-Geom-Deluxe</option>
                        <option value="lottes">CRT-Lottes (Timothy Lottes)</option>
                        <option value="vector-glow">Vector-Glow</option>
                        <option value="hsm-mega-bezel-reflection">HSM Mega Bezel Reflection</option>
                      </optgroup>
                      <optgroup label="Legacy">
                        <option value="lite">CRT Lite</option>
                        <option value="classic">CRT Classic</option>
                        <option value="vhs">CRT VHS</option>
                        <option value="ultra">CRT Ultra</option>
                      </optgroup>
                    </select>
                    <div className="mt-2 text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Applies to the whole screen</div>
                    <div className="mt-4 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-zinc-400 text-xs font-bold uppercase tracking-widest">Real CRT Shader</div>
                        <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-1">WebGL post-process (BETA)</div>
                      </div>
                      <button
                        onClick={() => {
                          const next = !crtShaderEnabled;
                          setCrtShaderError(null);
                          if (next) {
                            // Try to init WebGL immediately; if it fails, keep it OFF.
                            const st = ensureCrtGl();
                            if (!st) {
                              setCrtShaderError('WebGL not available on this device/browser.');
                              setCrtShaderReady(false);
                              setCrtShaderEnabled(false);
                              return;
                            }
                          }
                          setCrtShaderReady(next);
                          setCrtShaderEnabled(next);
                        }}
                        className={`relative w-14 h-8 rounded-full glass-button border border-white/15 ${crtShaderEnabled ? 'bg-white/20' : 'bg-black/30'} ${crtPreset === 'off' ? 'opacity-60' : ''}`}
                        aria-label="Toggle Real CRT Shader"
                        disabled={crtPreset === 'off'}
                      >
                        <span className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white/80 shadow transition-transform duration-200 ${crtShaderEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                      </button>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-zinc-400 text-xs font-bold uppercase tracking-widest">Apply to UI (HEAVY)</div>
                        <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-1">DOM capture → shader (very expensive)</div>
                      </div>
                      <button
                        onClick={() => {
                          const next = !crtShaderApplyToUi;
                          setCrtShaderError(null);
                          if (next) {
                            // Preload the capture lib. If it fails, keep it OFF.
                            ensureHtml2Canvas().catch((e: any) => {
                              setCrtShaderError(String(e?.message || e || 'Failed to enable UI capture.'));
                              setCrtShaderApplyToUi(false);
                            });
                          }
                          setCrtShaderApplyToUi(next);
                        }}
                        className={`relative w-14 h-8 rounded-full glass-button border border-white/15 ${crtShaderApplyToUi ? 'bg-white/20' : 'bg-black/30'} ${(!crtShaderEnabled || crtPreset === 'off') ? 'opacity-60' : ''}`}
                        aria-label="Toggle Apply CRT Shader to UI"
                        disabled={!crtShaderEnabled || crtPreset === 'off'}
                      >
                        <span className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white/80 shadow transition-transform duration-200 ${crtShaderApplyToUi ? 'translate-x-6' : 'translate-x-0'}`} />
                      </button>
                    </div>
                    <div className="mt-2 text-[10px] text-zinc-600 font-bold uppercase tracking-widest">Warning: may reduce FPS, especially on mobile</div>
                    {crtPreset === 'off' && (
                      <div className="mt-2 text-[10px] text-zinc-600 font-bold uppercase tracking-widest">Select a CRT preset to enable shader</div>
                    )}
                    {crtShaderError && (
                      <div className="mt-3 text-[10px] text-red-400 font-black uppercase tracking-widest">{crtShaderError}</div>
                    )}

                    {/* Bullet Shader (projectiles) */}
                    <div className="mt-6 pt-5 border-t border-white/10">
                      <div className="text-zinc-400 text-xs font-bold uppercase tracking-widest">Bullet Shader</div>
                      <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-1">WebGL glow for player projectiles</div>

                      <div className="mt-3 flex items-center justify-between gap-4">
                        <div>
                          <div className="text-zinc-400 text-xs font-bold uppercase tracking-widest">Enable</div>
                          <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-1">Glow + trail + flash + impact</div>
                        </div>
                        <button
                          onClick={() => {
                            const next = !bulletShaderEnabled;
                            setBulletShaderError(null);
                            if (next) {
                              const st = ensureBulletGl();
                              if (!st) return; // ensureBulletGl sets the error + keeps it OFF
                            }
                            setBulletShaderEnabled(next);
                          }}
                          className={`relative w-14 h-8 rounded-full glass-button border border-white/15 ${bulletShaderEnabled ? 'bg-white/20' : 'bg-black/30'}`}
                          aria-label="Toggle Bullet Shader"
                        >
                          <span className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white/80 shadow transition-transform duration-200 ${bulletShaderEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                        </button>
                      </div>

                      <div className="mt-3">
                        <div className="text-zinc-400 text-xs font-bold uppercase tracking-widest">Preset</div>
                        <select
                          value={bulletPreset}
                          onChange={(e) => setBulletPreset(e.target.value as any)}
                          className={`mt-2 w-full px-4 py-3 rounded-2xl glass-input text-white bg-black/40 border border-white/10 outline-none ${!bulletShaderEnabled ? 'opacity-60' : ''}`}
                          disabled={!bulletShaderEnabled}
                        >
                          <option value="neon-core">NEON Core (Minimal)</option>
                          <option value="plasma-pulse">PLASMA Pulse (Minimal)</option>
                          <option value="ion-beamlet">ION Beamlet (Minimal)</option>
                          <option value="void-shot">VOID Shot (Minimal)</option>
                          <option value="overcharge">OVERCHARGE (Minimal)</option>
                        </select>
                      </div>

                      {bulletShaderError && (
                        <div className="mt-3 text-[10px] text-red-400 font-black uppercase tracking-widest">{bulletShaderError}</div>
                      )}
                    </div>

                  </div>
                </div>

                <div className="p-4 bg-black/25 rounded-2xl border border-white/10">
                  <div className="text-white/80 text-[10px] uppercase font-black tracking-[0.2em]">Audio</div>

                  <div className="mt-4">
                    <div className="flex items-center justify-between">
                      <div className="text-zinc-400 text-xs font-bold uppercase tracking-widest">SFX Volume</div>
                      <div className="text-white font-mono text-xs font-black">{Math.round(sfxVolume * 100)}%</div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={sfxVolume}
                      onChange={(e) => setSfxVolume(Number(e.target.value))}
                      className="mt-2 w-full"
                    />
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center justify-between">
                      <div className="text-zinc-400 text-xs font-bold uppercase tracking-widest">Music Volume</div>
                      <div className="text-white font-mono text-xs font-black">{Math.round(musicVolume * 100)}%</div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={musicVolume}
                      onChange={(e) => setMusicVolume(Number(e.target.value))}
                      className="mt-2 w-full"
                    />
                  </div>

                  <div className="mt-5 flex gap-3">
                    <button
                      onClick={toggleSfx}
                      className={`flex-1 py-3 rounded-2xl font-black text-[11px] uppercase tracking-widest border transition-all glass-button ${savedData.sfxEnabled ? 'bg-white/10 text-white border-white/15' : 'bg-white/5 text-zinc-500 border-white/10'}`}
                    >
                      {savedData.sfxEnabled ? 'SFX ON' : 'SFX OFF'}
                    </button>
                    <button
                      onClick={() => { setSfxVolume(0.5); setMusicVolume(0.35); }}
                      className="flex-1 py-3 rounded-2xl font-black text-[11px] uppercase tracking-widest glass-button bg-white/5 text-zinc-400 border-white/10 hover:bg-white/10"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {menuScreen === 'MAIN' && (
            <div className="flex flex-col items-center max-w-lg w-full animate-in fade-in zoom-in duration-500">
               <div className="absolute top-4 right-4 sm:top-8 sm:right-8 flex gap-3 sm:gap-4">
                 <button onClick={toggleFullScreen} className="p-2 sm:p-4 rounded-full glass-button transition-all text-white border-white/25">
                    {isFullScreen ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                    )}
                 </button>
                 <button onClick={toggleSfx} className={`p-2 sm:p-4 rounded-full glass-button transition-all ${savedData.sfxEnabled ? 'text-white border-white/25' : 'text-zinc-600 border-zinc-800'}`}>
                    {savedData.sfxEnabled ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2-2m2 2l2-2m2 2l2 2" /></svg>
                    )}
                 </button>
               </div>
               <h1 onClick={() => {
                   const now = Date.now();
                   if (now - lastTapTime.current < 500) titleTapCount.current++; else titleTapCount.current = 1;
                   lastTapTime.current = now;
                   if (titleTapCount.current >= 7) { setShowDevMenu(true); }
               }} className="text-5xl sm:text-7xl md:text-9xl font-black text-white neon-text animate-float-title mb-8 sm:mb-16 italic tracking-tighter cursor-pointer text-center select-none leading-none">
                 NEON<br/><span className="text-white">PROTOCOL</span>
               </h1>
               <div className="flex flex-col gap-3 sm:gap-5 w-full px-2 sm:px-4">
                 <button onClick={initRun} style={animDelay(120)} className="w-full py-3 sm:py-5 glass-button shimmer shimmer-strong stagger-in cta-gradient text-white font-black text-lg sm:text-2xl shadow-lg rounded-2xl uppercase italic tracking-wider">Iniciar Jogo</button>
                 <div className="grid grid-cols-2 gap-4">
                    <button onClick={() => { setStoreTab('UPGRADES'); setMenuScreen('SHOP'); }} style={animDelay(200)} className="py-2.5 sm:py-4 glass-button stagger-in text-white font-bold text-sm sm:text-lg rounded-2xl flex items-center justify-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 100-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" /></svg>Store</button>
                    <button onClick={() => setMenuScreen('CREDITS')} style={animDelay(260)} className="py-2.5 sm:py-4 glass-button stagger-in text-zinc-400 font-bold text-sm sm:text-lg rounded-2xl flex items-center justify-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg>Logs</button>
                 </div>
               </div>
               <div style={animDelay(340)} className="mt-8 sm:mt-12 p-4 sm:p-5 premium-card text-center w-full max-w-sm stagger-in">
                  <div className="text-zinc-500 text-[11px] sm:text-xs uppercase tracking-[0.2em] mb-1 font-bold">Neural Credits</div>
                  <div className="text-white font-mono text-2xl sm:text-3xl font-black">{savedData.totalCoins} <span className="text-zinc-600 text-sm">CR</span></div>
               </div>
               <div style={animDelay(420)} className="fixed bottom-8 right-8 sm:bottom-10 sm:right-12 text-right select-none stagger-in">
                  <button
                    type="button"
                    onClick={() => setShowUpdateNotes(true)}
                    className="text-zinc-500 text-xl sm:text-2xl font-medium bg-transparent p-0 hover:text-zinc-400 active:scale-[0.98] transition"
                    aria-label="Ver notas da atualização"
                  >
                    {APP_VERSION}
                  </button>
                  <div className="text-zinc-700/80 text-[11px] sm:text-sm tracking-wide">www.neonprotocol.com</div>
               </div>
            </div>
          )}

          {menuScreen === 'SHOP' && (
            <div className="max-w-4xl w-full premium-card ui-panel p-3 sm:p-8 ui-pop-in">
               <div className="flex justify-between items-end mb-5 sm:mb-8">
                  <div>
                    <h2 className="text-2xl sm:text-4xl font-black text-white italic uppercase leading-none">Neural Upgrades</h2>
                    <p className="text-zinc-500 text-sm mt-2 uppercase tracking-widest font-bold">Permanent Upgrades / Skins</p>
                  </div>
                  <div className="text-white font-mono font-black text-xl sm:text-2xl bg-white/10 px-3 sm:px-4 py-2 rounded-xl border border-white/10 backdrop-blur-md">{savedData.totalCoins} <span className="text-xs">CR</span></div>
               </div>
               <div className="flex flex-wrap gap-3 mb-6 items-center">
                 <button
                   onClick={() => setStoreTab('UPGRADES')}
                   className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-2xl font-black text-[11px] sm:text-xs uppercase tracking-widest border transition-all ${storeTab === 'UPGRADES' ? 'bg-white/15 text-white border-white/25' : 'bg-white/5 text-zinc-400 border-white/10 hover:bg-white/10'}`}
                 >
                   Upgrades
                 </button>
                 <button
                   onClick={() => setStoreTab('SKINS')}
                   className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-2xl font-black text-[11px] sm:text-xs uppercase tracking-widest border transition-all ${storeTab === 'SKINS' ? 'bg-white/15 text-white border-white/25' : 'bg-white/5 text-zinc-400 border-white/10 hover:bg-white/10'}`}
                 >
                   Skins
                 </button>
                 <div className="ml-auto hidden sm:block text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Permanent upgrades affect every run</div>
               </div>

               {storeTab === 'UPGRADES' && (
                 <div className="max-h-[55vh] overflow-y-auto pr-2">
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                     {PERMANENT_UPGRADES.map((u) => {
                       const level = savedData.permanentUpgrades[u.key];
                       const maxed = level >= u.maxLevel;
                       const cost = getPermanentUpgradeCost(u.baseCost, u.costMult, level);
                       const canBuy = !maxed && savedData.totalCoins >= cost;
                       return (
                        <div key={u.key} className="p-3 sm:p-6 rounded-[28px] ui-panel ui-pop-in">
                           <div className="flex items-start gap-4">
                             <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center text-lg sm:text-2xl bg-white/5 border border-white/10">{u.icon}</div>
                             <div className="flex-1">
                               <div className="flex items-center justify-between">
                                 <div className="font-black text-white uppercase tracking-wider">{u.name}</div>
                                 <div className="text-xs font-black text-white bg-white/10 px-3 py-1 rounded-xl border border-white/10">LV {level}/{u.maxLevel}</div>
                               </div>
                               <div className="text-zinc-400 text-sm mt-1">{u.description}</div>
                               <div className="text-[11px] mt-3 text-zinc-500 font-bold uppercase tracking-widest">Next: <span className="text-zinc-200">{u.effectText(level)}</span></div>
                             </div>
                           </div>

                           <div className="mt-4 flex items-center gap-3">
                             <button
                               disabled={!canBuy}
                               onClick={() => buyPermanentUpgrade(u.key, u.baseCost, u.costMult, level, u.maxLevel)}
                               className={`flex-1 py-2.5 sm:py-3 rounded-2xl font-black text-[11px] sm:text-xs uppercase transition-all ${maxed ? 'bg-white/5 text-zinc-600 cursor-not-allowed' : canBuy ? 'bg-white/12 text-white hover:bg-white/20' : 'bg-white/5 text-zinc-500 cursor-not-allowed'}`}
                             >
                               {maxed ? 'MAXED' : `BUY • ${cost} CR`}
                             </button>
                             <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Owned: <span className="text-zinc-200">{level}</span></div>
                           </div>
                         </div>
                       );
                     })}
                   </div>
                 </div>
               )}

               {storeTab === 'SKINS' && (
                 <div className="max-h-[55vh] overflow-y-auto pr-2">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-6">
                    {SKINS.map(skin => {
                      const isUnlocked = savedData.unlockedSkins.includes(skin.id), isEquipped = savedData.selectedSkin === skin.id;
                      return (
                        <div key={skin.id} className={`p-4 sm:p-6 rounded-[28px] glass-button transition-all flex flex-col items-center ${isEquipped ? 'border-white/25 bg-white/10' : 'bg-white/5 border-white/10'}`}>
                          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center border-4 relative mb-5 sm:mb-6 overflow-hidden" style={{ borderColor: isEquipped ? skin.color : 'rgba(255,255,255,0.1)' }}><div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full shadow-[0_0_20px_rgba(255,255,255,0.2)]" style={{ backgroundColor: skin.color }}></div><div className="absolute inset-0 bg-gradient-to-tr from-black/20 to-transparent"></div></div>
                          <div className="text-center mb-6"><div className="font-black text-sm text-white uppercase tracking-wider">{skin.name}</div><div className="text-[10px] text-zinc-500 font-bold uppercase mt-1 tracking-widest">Core Module</div></div>
                          <button onClick={() => buyOrEquipSkin(skin.id, skin.price)} className={`w-full py-2.5 sm:py-3 rounded-2xl font-black text-[11px] sm:text-xs uppercase transition-all ${isEquipped ? 'bg-white/20 text-white' : 'bg-white/10 text-zinc-400 hover:bg-white/20'}`}>{isEquipped ? 'Active' : isUnlocked ? 'Engage' : `${skin.price} CR`}</button>
                        </div>
                      );
                    })}
                  </div>
                 </div>
               )}

               <button onClick={() => setMenuScreen('MAIN')} className="mt-6 sm:mt-8 w-full py-3 sm:py-4 glass-button bg-white/10 text-white font-black rounded-2xl uppercase text-sm hover:bg-white/20 transition-all">Return to Terminal</button>
            </div>
          )}
          {menuScreen === 'CREDITS' && (
            <div className="max-w-md w-full premium-card ui-panel p-6 sm:p-10 text-center ui-pop-in">
                <div className="w-16 h-1 w-24 bg-white/20 mx-auto mb-8 rounded-full"></div>
                <h2 className="text-2xl sm:text-4xl font-black text-white italic mb-8 sm:mb-10 uppercase tracking-tighter">System Logs</h2>
                <div className="space-y-8 font-mono text-sm">
                  <div className="p-4 bg-black/40 rounded-2xl border border-white/5"><div className="text-white/80 text-[10px] uppercase font-black mb-2 tracking-[0.2em]">Project Identification</div><div className="text-white text-xl font-black">NEON_PROTOCOL.EXE</div></div>
                  <div className="p-4 bg-black/40 rounded-2xl border border-white/5"><div className="text-white/80 text-[10px] uppercase font-black mb-2 tracking-[0.2em]">Neural Engine</div><div className="text-white font-bold">CANVAS / VITE / REACT</div></div>
                  <div className="pt-8 text-[11px] text-zinc-500 leading-relaxed italic uppercase font-bold tracking-widest">"Adapt or disintegrate. The grid demands perfection."</div>
                </div>
                <button onClick={() => setMenuScreen('MAIN')} className="mt-10 sm:mt-12 w-full py-4 sm:py-5 glass-button bg-white/10 text-white font-black rounded-2xl transition-all uppercase tracking-widest text-sm shadow-lg">Disconnect</button>
            </div>
          )}

          {showUpdateNotes && (
            <div
              className="absolute inset-0 z-[80] bg-black/60 backdrop-blur-[6px] flex items-center justify-center p-4"
              onClick={() => setShowUpdateNotes(false)}
              role="dialog"
              aria-modal="true"
              aria-label="Notas da atualização"
            >
              <div className="max-w-lg w-full premium-card ui-panel p-6 sm:p-8 ui-pop-in" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-zinc-500 text-[10px] font-bold uppercase tracking-[0.35em]">Atualização</div>
                    <div className="text-white font-black text-2xl sm:text-3xl italic tracking-tighter">{APP_VERSION}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowUpdateNotes(false)}
                    className="p-2 rounded-xl glass-button bg-white/5 border-white/10 hover:bg-white/10"
                    aria-label="Fechar"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                  </button>
                </div>
                <div className="mt-5 p-4 bg-black/30 rounded-2xl border border-white/10">
                  <div className="text-zinc-200 text-sm leading-relaxed whitespace-pre-line">{APP_UPDATE_NOTES}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowUpdateNotes(false)}
                  className="mt-6 w-full py-3 sm:py-4 glass-button bg-white/10 text-white font-black rounded-2xl uppercase text-sm hover:bg-white/20 transition-all"
                >
                  Voltar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {(gameState === GameState.PLAYING || gameState === GameState.PAUSED) && stats && (
        <div className="absolute inset-0 pointer-events-none">
          {/* Dash Button (Mobile) */}
          {stats.hasDash && gameState === GameState.PLAYING && (
             <div className="absolute bottom-6 right-6 sm:bottom-10 sm:right-10 pointer-events-auto">
                <button onClick={() => engineRef.current?.triggerDash()} className={`w-14 h-14 sm:w-20 sm:h-20 rounded-full border-4 flex items-center justify-center transition-all bg-black/20 backdrop-blur-md active:scale-90 ${dashCdPercent > 0 ? 'border-white/10 text-white/20' : 'border-white/25 text-white shadow-[0_0_20px_rgba(255,255,255,0.16)]'}`}>
                  <div className="absolute inset-0 rounded-full border-t-4 border-white/60 animate-spin" style={{ display: dashCdPercent > 0 ? 'block' : 'none' }}></div>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 sm:h-10 sm:w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </button>
             </div>
          )}
          <div className="absolute top-0 left-0 w-full p-2 sm:p-6 flex justify-between items-start" style={{ paddingTop: `calc(env(safe-area-inset-top, 0px) + 8px)` }}>
            <div className="space-y-2 sm:space-y-3 bg-black/20 p-2 sm:p-4 rounded-3xl backdrop-blur-lg border border-white/10">
              {stats.shieldLevel > 0 && (
                <div className="flex items-center gap-3"><div className="text-[10px] font-black text-cyan-400 uppercase tracking-widest">SHLD</div><div className="w-32 sm:w-56 h-2 bg-black/40 rounded-full overflow-hidden border border-white/5"><div className="h-full shadow-[0_0_10px_rgba(34,211,238,0.4)] hud-bar-inner" style={{ width: `${(stats.shield / stats.maxShield) * 100}%`, backgroundColor: '#22d3ee' }} /></div></div>
              )}
              <div className="flex items-center gap-3"><div className="text-[10px] sm:text-xs font-black text-white uppercase tracking-widest">HP</div><div className="w-32 sm:w-56 h-2.5 sm:h-3 bg-black/40 rounded-full overflow-hidden border border-white/5"><div className="h-full shadow-[0_0_15px_rgba(255,255,255,0.18)] hud-bar-inner" style={{ width: `${(stats.hp / stats.maxHp) * 100}%`, backgroundColor: '#ffffff' }} /></div></div>
              <div className="flex items-center gap-3"><div className="text-[10px] sm:text-xs font-black text-zinc-500 uppercase tracking-widest">XP</div><div className="w-32 sm:w-56 h-1.5 bg-black/40 rounded-full overflow-hidden border border-white/5"><div className="h-full bg-white/30 hud-bar-inner" style={{ width: `${(stats.xp / stats.nextLevelXp) * 100}%` }} /></div></div>
              
              <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-2 sm:mt-4 max-w-[240px] sm:max-w-[340px]">
                 {stats.hpPlusLevel > 0 && <div className="px-2 py-1 bg-white/5 border border-white/10 rounded text-[9px] font-black text-red-400 backdrop-blur-md">MAX HP: +{stats.hpPlusLevel * 10}</div>}
                 {stats.regenLevel > 0 && <div className="px-2 py-1 bg-white/5 border border-white/10 rounded text-[9px] font-black text-green-400 backdrop-blur-md">REGEN: {Math.min(12, 0.6 + stats.regenLevel * 0.9).toFixed(1)}%/10s</div>}
                 {stats.knockbackLevel > 0 && <div className="px-2 py-1 bg-white/5 border border-white/10 rounded text-[9px] font-black text-indigo-400 backdrop-blur-md">KB: +{stats.knockbackLevel * 10}%</div>}
                 {stats.speedLevel > 0 && <div className="px-2 py-1 bg-white/5 border border-white/10 rounded text-[9px] font-black text-rose-400 backdrop-blur-md">SPD: +{stats.speedLevel * 4}%</div>}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="px-3 sm:px-5 py-1.5 sm:py-2 premium-card flex flex-col items-end"><div className="text-white font-black text-lg sm:text-2xl italic leading-none">ROUND {round}</div><div className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest mt-1">Level {stats.level}</div></div>
              <div className="px-3 sm:px-4 py-1.5 bg-black/20 backdrop-blur-lg rounded-xl border border-white/10 flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]"></div><div className="text-yellow-500 font-mono font-bold text-xs">{stats.coins} CR</div></div>
            </div>
          </div>
          <div className="absolute top-3 sm:top-6 left-1/2 -translate-x-1/2 pointer-events-auto" style={{ top: `calc(env(safe-area-inset-top, 0px) + 12px)` }}><div className="flex gap-2 p-1 bg-black/20 backdrop-blur-lg rounded-2xl border border-white/10"><button onClick={(e) => { e.stopPropagation(); gameState === GameState.PLAYING ? pauseGame() : resumeGame(); }} className="px-2.5 sm:px-4 py-1 sm:py-2 hover:bg-white/10 rounded-xl transition-all">{gameState === GameState.PLAYING ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:h-5 sm:w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:h-5 sm:w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}</button></div></div>
        </div>
      )}
      {gameState === GameState.PAUSED && (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-lg flex items-center justify-center p-4 sm:p-6 pointer-events-auto">
          <div className="w-full max-w-sm premium-card ui-panel p-6 sm:p-10 text-center ui-pop-in">
            <div className="text-white font-black text-2xl sm:text-4xl italic uppercase mb-2 tracking-tighter">Simulation Frozen</div><div className="text-zinc-500 text-[10px] font-bold uppercase tracking-[0.3em] mb-10">Terminal Paused</div>
            <div className="grid gap-4">
              <button onClick={resumeGame} className="w-full py-4 sm:py-5 glass-button cta-gradient text-white font-black rounded-2xl uppercase tracking-widest text-sm shadow-lg">Resume</button>
              <button onClick={restartRun} className="w-full py-3.5 sm:py-4 glass-button bg-white/5 text-white font-black rounded-2xl uppercase tracking-widest text-sm">Restart</button>
              <button onClick={backToMainMenu} className="w-full py-3.5 sm:py-4 glass-button bg-red-900/20 text-red-400 border-red-900/30 font-black rounded-2xl uppercase tracking-widest text-sm">Abort</button>
            </div>
          </div>
        </div>
      )}
      {gameState === GameState.LEVEL_UP && (
        <div className="absolute inset-0 bg-black/30 backdrop-blur-xl flex items-center justify-center p-3 sm:p-4">
          <div className="max-w-xl w-full upgrade-glass p-4 sm:p-10 ui-pop-in">
            <div className="text-center mb-6 sm:mb-10"><h2 className="text-xl sm:text-3xl font-black text-white uppercase tracking-tighter italic">Optimization Required</h2><p className="text-white/60 text-[10px] font-bold uppercase tracking-[0.4em] mt-2">Choose your augment</p></div>
            <div className="grid gap-3 sm:gap-5 max-h-[74vh] sm:max-h-[60vh] overflow-y-auto pr-2">
              {randomUpgrades.map((upgrade, i) => (
                <button key={upgrade.id} onClick={() => selectUpgrade(upgrade)} style={animDelay(i * 90)} className={`flex items-center p-3 sm:p-5 glass-button deck-in upgrade-card ${upgrade.isRare ? 'shimmer shimmer-rare rare border-yellow-500/30 bg-yellow-500/5 hover:bg-yellow-500/15' : 'border-white/5 bg-white/5 hover:bg-white/10'} border-2 rounded-[28px] text-left group`}>
                  <span className={`text-2xl sm:text-4xl mr-3 sm:mr-6 p-2.5 sm:p-4 rounded-2xl group-hover:scale-110 transition-transform ${upgrade.isRare ? 'bg-yellow-500/10' : 'bg-black/40'}`}>{upgrade.icon}</span>
                  <div className="flex-1">
                    <div className={`font-black uppercase tracking-wider transition-colors ${upgrade.isRare ? 'text-yellow-400' : 'text-white group-hover:text-white'}`}>{upgrade.isRare && <span className="text-[10px] block font-black text-yellow-600/80 mb-1">RARE MODULE</span>}{upgrade.name}</div>
                    <div className={`text-xs font-medium mt-1 uppercase tracking-tight ${upgrade.id === 'glass_cannon' ? 'text-red-400' : 'text-zinc-500'}`}>{upgrade.description}</div>
                  </div>
                  <div className="ml-4 opacity-0 group-hover:opacity-100 transition-opacity"><svg xmlns="http://www.w3.org/2000/svg" className={`h-6 w-6 ${upgrade.isRare ? 'text-yellow-500' : 'text-white/80'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg></div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {gameState === GameState.GAME_OVER && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-2xl flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-700">
          <div className="w-24 h-1 bg-red-600 mb-8 rounded-full shadow-[0_0_20px_rgba(220,38,38,0.8)]"></div>
          <h2 className="text-5xl sm:text-8xl font-black text-white italic uppercase tracking-tighter mb-4 animate-pulse">CRITICAL<br/><span className="text-red-600">ERROR</span></h2><p className="text-zinc-500 font-bold uppercase tracking-[0.5em] mb-16 text-xs">Neural Sync Terminated</p>
          <div className="premium-card p-8 border-white/5 mb-16 max-w-sm w-full backdrop-blur-3xl"><div className="text-zinc-600 text-[10px] font-black uppercase mb-2 tracking-widest">Rewards Recovered</div><div className="text-white text-3xl font-black font-mono">{engineRef.current?.stats.coins || 0} <span className="text-white/80">CR</span></div></div>
          <button onClick={() => { backToMainMenu(); }} className="px-10 sm:px-16 py-4 sm:py-5 glass-button cta-gradient text-white font-black text-base sm:text-lg rounded-2xl uppercase tracking-widest hover:scale-105 transition-transform">Re-Connect</button>
        </div>
      )}

      </div>

      {/* CRT Overlay (visual-only) */}
      {crtPreset !== 'off' && !fullShaderActive && gameState !== GameState.MENU && (
        <div className={`crt-overlay crt-${crtPreset}`} aria-hidden="true" data-html2canvas-ignore="true" />
      )}
    </div>
  );
}