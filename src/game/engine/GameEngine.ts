
import { Entity, Player, Enemy, Boss, Bullet, ExperienceCrystal, EnemyBullet, DroneSwarmEnemy, BurstHunterEnemy, Drone, Structure, HealthPickup, StructureType } from '../entities/Entities';
import { ParticleSystem } from '../systems/Particles';
import { DamageNumber } from '../systems/DamageNumbers';
import { PlayerStats, GameState } from '../../types';
import { COLORS, INITIAL_STATS, ROUND_DURATION, MAX_ENEMIES, REGEN_INTERVAL } from '../config/constants';
import { AudioService } from '../../services/AudioService';

export class GameEngine {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;

  // Viewport (CSS pixels) and render scale (device pixel ratio)
  private viewW = 0;
  private viewH = 0;
  private dpr = 1;
  // Visual: camera zoom (1 = normal). Valores menores mostram mais do mapa.
  // Ajuste automático por tamanho de tela para ficar "bom no celular" sem ficar muito pequeno/pixelizado.
  private cameraZoom = 0.7;
  private readonly minCameraZoom = 0.6;
  private readonly maxCameraZoom = 0.9;
  player: Player;
  stats: PlayerStats;
  enemies: Enemy[] = [];
  boss: Boss | null = null;
  bullets: Bullet[] = [];
  enemyBullets: EnemyBullet[] = [];
  xpCrystals: ExperienceCrystal[] = [];
  structures: Structure[] = [];
  healthPickups: HealthPickup[] = [];
  particles: ParticleSystem;
  damageNumbers: DamageNumber[] = [];
  drone: Drone | null = null;
  
  round = 1;
  lastRoundUpdate = 0;
  lastEnemySpawn = 0;
  lastShoot = 0;
  lastDroneShoot = 0;
  lastFearPulse = 0;
  lastFreezePulse = 0;
  lastAuraTick = 0;
  lastPulseTime = 0;
  pulseVisualTimer = 0;

  // Structures (cover) maintenance
  private lastStructureCheck = 0;
  private structureTarget = 14;
  private structureCheckIntervalMs = 3000;
  private structureDespawnDist = 2200;
  private structureDamageDpsPerEnemy = 12;
  
  // Dash system
  dashTimer = 0;
  dashCooldown = 0;
  playerVelX = 0;
  playerVelY = 0;

  // Defense Timers
  invincibilityTimer = 0;
  lastDamageTime = 0;
  lastShieldTickTime = 0;

  // Progression tracking
  lastLevelUpTime = 0;

  gameState: GameState = GameState.MENU;
  spawningEnabled = true;
  isDemo = false;
  
  regenTimer = REGEN_INTERVAL;
  godMode = false;
  timeScale = 1.0;

  // Rendering toggles (visual-only). Gameplay is unaffected.
  // When false, player bullets are NOT drawn in the 2D canvas so another renderer
  // (e.g., a WebGL shader layer) can draw them without double-rendering.
  renderPlayerBullets2D: boolean = true;

  // Screen feedback (damage + low HP)
  private screenShakeTime = 0;
  private screenShakeStrength = 0;
  private screenShakeX = 0;
  private screenShakeY = 0;
  private damageFlashTime = 0;

  private prevPlayerX = 0;
  private prevPlayerY = 0;
  private playerVx = 0; // For aiming lead
  private playerVy = 0; // For aiming lead
  private demoAngle = 0;

  // Camera (world -> screen). Uses a deadzone so the player can move a bit on screen.
  private cameraX = 0;
  private cameraY = 0;

  // Chão com textura (tile) repetida - só afeta o render
  private floorImage: HTMLImageElement | null = null;
  private floorPattern: CanvasPattern | null = null;
  private floorTileW = 0;
  private floorTileH = 0;

// FX spritesheet (render only): /assets/fx/spellsheet.png
private fxImage: HTMLImageElement | null = null;
private fxReady = false;
private fxCols = 0;
private fxFrame = 0;
private fxFrameAccMs = 0;
private fxFps = 12;

  // Global afterimage / motion-trail strength.
  // Lower alpha => stronger/more persistent trails.

  joystick: { active: boolean; base: {x: number, y: number}; current: {x: number, y: number} } = {
    active: false,
    base: {x:0, y:0},
    current: {x:0, y:0}
  };

  keys: Set<string> = new Set();
  
  onLevelUp: () => void;
  onGameOver: (coins: number) => void;

  constructor(canvas: HTMLCanvasElement, onLevelUp: () => void, onGameOver: (coins: number) => void) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.player = new Player(canvas.width / 2, canvas.height / 2);
    this.stats = { ...INITIAL_STATS };
    // FIXO: atributos base do player (sem progressão)
    this.stats.maxHp = 100;
    this.stats.hp = 100;
    this.stats.damage = 3;
    this.particles = new ParticleSystem();
    this.onLevelUp = onLevelUp;
    this.onGameOver = onGameOver;

    // Floor texture (repeat tile) - optional, falls back to grid if not loaded
    this.floorImage = new Image();
    this.floorImage.src = '/floor-tile.png';
    this.floorImage.onload = () => {
      const srcW = this.floorImage!.naturalWidth || this.floorImage!.width;
      const srcH = this.floorImage!.naturalHeight || this.floorImage!.height;

      // Performance: reduz o tile se a imagem for muito grande (o fillPattern em tile gigante pesa MUITO)
      const MAX_TILE = 512; // mantém boa qualidade mas bem mais leve
      const scale = Math.min(1, MAX_TILE / Math.max(srcW, srcH));
      const dstW = Math.max(1, Math.round(srcW * scale));
      const dstH = Math.max(1, Math.round(srcH * scale));

      // Cria um tile reduzido (uma vez só) e usa ele no pattern
      const tile = document.createElement('canvas');
      tile.width = dstW;
      tile.height = dstH;
      const tctx = tile.getContext('2d')!;
      tctx.drawImage(this.floorImage!, 0, 0, dstW, dstH);

      this.floorTileW = dstW;
      this.floorTileH = dstH;
      this.floorPattern = this.ctx.createPattern(tile, 'repeat');
    };
    this.floorImage.onerror = () => { this.floorPattern = null; };

    this.lastRoundUpdate = Date.now();
  }


setGraphicsQuality(q: 'low' | 'medium' | 'high') {
  // Partículas: limita no low pra performance
  this.particles.fxQuality = q;
  this.particles.maxParticles = (q === 'low') ? 520 : (q === 'high' ? 1200 : 900);
}
  private computeDefaultCameraZoom(viewW: number, viewH: number) {
    const minDim = Math.min(viewW, viewH);
    // Tuning simples: mais zoom-out em telas pequenas, um pouco menos em telas maiores
    let z = 0.8;
    if (minDim <= 380) z = 0.65;       // celulares pequenos
    else if (minDim <= 480) z = 0.70;  // celulares comuns
    else if (minDim <= 720) z = 0.78;  // tablets / telas médias
    else z = 0.85;                     // desktop / telas grandes

    // Clamp de segurança
    z = Math.max(this.minCameraZoom, Math.min(this.maxCameraZoom, z));
    return z;
  }

  resize(width: number, height: number, dpr: number = 1) {
  this.viewW = width;
  this.viewH = height;
  this.dpr = Math.max(1, dpr || 1);
  this.cameraZoom = this.computeDefaultCameraZoom(width, height);


  // Canvas internal size (device pixels)
  this.canvas.width = Math.floor(width * this.dpr);
  this.canvas.height = Math.floor(height * this.dpr);

  // Keep world coordinates in CSS pixels
  if (this.player) {
    this.player.x = width / 2;
    this.player.y = height / 2;
    // mantém o player centralizado após mudanças de zoom/tamanho
    this.cameraX = this.player.worldX - (this.viewW / this.cameraZoom) / 2;
    this.cameraY = this.player.worldY - (this.viewH / this.cameraZoom) / 2;
  }
}

  applyPermanentBonuses(upgrades: { health: number, damage: number, speed: number }, skinColor: string) {
        // FIXO: HP e dano do player não mudam por upgrades
    this.stats.maxHp = 100;
    this.stats.hp = Math.min(this.stats.hp, this.stats.maxHp);
    this.stats.damage = 3;
    this.stats.speed *= (1 + upgrades.speed * 0.05);
    this.player.color = skinColor;
  }

  start(isDemo = false) {
    this.isDemo = isDemo;
    this.gameState = isDemo ? GameState.MENU : GameState.PLAYING;
    this.stats = { ...INITIAL_STATS };
    this.enemies = [];
    this.boss = null;
    this.bullets = [];
    this.enemyBullets = [];
    this.damageNumbers = [];
    this.xpCrystals = [];
    this.structures = [];
    this.healthPickups = [];
    this.drone = null;
    this.round = 1;
    this.spawningEnabled = true;
    this.lastRoundUpdate = Date.now();
    this.lastLevelUpTime = Date.now();
    this.godMode = isDemo;
    this.timeScale = 1.0;
    this.regenTimer = REGEN_INTERVAL;
    this.keys.clear();
    this.player.x = this.viewW / 2;
    this.player.y = this.viewH / 2;
    this.cameraX = this.player.worldX - (this.viewW / this.cameraZoom) / 2;
    this.cameraY = this.player.worldY - (this.viewH / this.cameraZoom) / 2;
    this.lastStructureCheck = Date.now();
    this.spawnInitialStructures();
    this.playerVelX = 0;
    this.playerVelY = 0;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.invincibilityTimer = 0;
    this.lastDamageTime = 0;
    this.lastShieldTickTime = 0;
    this.prevPlayerX = this.player.x;
    this.prevPlayerY = this.player.y;
    this.playerVx = 0;
    this.playerVy = 0;
    this.demoAngle = Math.random() * Math.PI * 2;
    this.lastFearPulse = Date.now();
    this.lastFreezePulse = Date.now();
    this.lastAuraTick = Date.now();
    this.lastPulseTime = Date.now();
    this.pulseVisualTimer = 0;
    this.screenShakeTime = 0;
    this.screenShakeStrength = 0;
    this.screenShakeX = 0;
    this.screenShakeY = 0;
    this.damageFlashTime = 0;
  }

  triggerDash() {
    if (!this.stats.hasDash || this.dashCooldown > 0 || this.gameState !== GameState.PLAYING) return;
    this.dashTimer = 0.15;
    const baseCd = 3.0;
    const reduction = this.stats.dashCdLevel * 0.07;
    this.dashCooldown = Math.max(1.2, baseCd * (1 - reduction));
    this.particles.emit(this.player.x, this.player.y, this.player.color, 15);
  }

  private updateAutopilot(timeMult: number) {
    this.demoAngle += 0.015 * timeMult;
    let moveX = Math.cos(this.demoAngle);
    let moveY = Math.sin(this.demoAngle * 0.5);
    for (const e of this.enemies) {
      const dx = this.player.x - e.x;
      const dy = this.player.y - e.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 180 * 180) {
        const d = Math.sqrt(d2) || 1;
        const weight = (1 - d / 180) * 4;
        moveX += (dx / d) * weight;
        moveY += (dy / d) * weight;
      }
    }
    const mag = Math.sqrt(moveX * moveX + moveY * moveY) || 1;
    const nx = moveX / mag;
    const ny = moveY / mag;
    
    const speedMult = (1 + this.stats.speedLevel * 0.04);
    this.player.x += nx * (this.stats.speed * speedMult) * 0.85 * timeMult;
    this.player.y += ny * (this.stats.speed * speedMult) * 0.85 * timeMult;

    // Camera follows demo movement too
    this.cameraX = this.player.worldX - (this.viewW / this.cameraZoom) / 2;
    this.cameraY = this.player.worldY - (this.viewH / this.cameraZoom) / 2;
  }

  private addScreenShake(intensity: number) {
    const dur = 0.16;
    const capped = Math.min(18, Math.max(0, intensity));
    this.screenShakeTime = Math.max(this.screenShakeTime, dur);
    this.screenShakeStrength = Math.max(this.screenShakeStrength, capped);
  }

  private triggerDamageFlash() {
    this.damageFlashTime = Math.max(this.damageFlashTime, 0.12);
  }


  private spawnDamageNumber(x: number, y: number, amount: number, color = '#EAFBFF') {
    // keep it minimal; "crit" only for noticeably high hits
    const isCrit = amount >= Math.max(18, this.stats.damage * 1.75);
    if (this.damageNumbers.length > 140) return;
    this.damageNumbers.push(new DamageNumber(x, y, amount, color, isCrit));
  }
// --- Structures (Cover) helpers ---
private spawnInitialStructures() {
  // Rings around player at start
  const nearCount = 2 + Math.floor(Math.random() * 2); // 2-3
  const midCount = 3 + Math.floor(Math.random() * 2);  // 3-4
  const farCount = 4 + Math.floor(Math.random() * 3);  // 4-6

  this.spawnStructuresInRing(180, 320, nearCount);
  this.spawnStructuresInRing(500, 750, midCount);
  this.spawnStructuresInRing(900, 1300, farCount);
}

private maintainStructures(now: number) {
  if (now - this.lastStructureCheck < this.structureCheckIntervalMs) return;
  this.lastStructureCheck = now;

  const px = this.player.x;
  const py = this.player.y;
  const maxD2 = this.structureDespawnDist * this.structureDespawnDist;

  // Despawn far structures
  this.structures = this.structures.filter(s => {
    const dx = s.cx - px;
    const dy = s.cy - py;
    return (dx * dx + dy * dy) <= maxD2;
  });

  // Spawn more if below target (spawn in far ring)
  if (this.structures.length < this.structureTarget) {
    const missing = Math.min(3, this.structureTarget - this.structures.length);
    this.spawnStructuresInRing(900, 1300, missing);
  }
}

private spawnStructuresInRing(minDist: number, maxDist: number, count: number) {
  for (let i = 0; i < count; i++) {
    for (let tries = 0; tries < 20; tries++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = minDist + Math.random() * (maxDist - minDist);
      const cx = this.player.x + Math.cos(angle) * dist;
      const cy = this.player.y + Math.sin(angle) * dist;

      if (this.trySpawnStructureAtCenter(cx, cy)) break;
    }
  }
}

private trySpawnStructureAtCenter(cx: number, cy: number) {
  // Random type (visual only)
  const roll = Math.random();
  const type: StructureType = roll < 0.42 ? 'bush' : (roll < 0.78 ? 'rock' : 'crate');

  // Size / HP by type
  let w = 44, h = 34, hp = 60;
  if (type === 'rock') { w = 54; h = 44; hp = 90; }
  if (type === 'crate') { w = 40; h = 40; hp = 70; }

  const x = cx - w / 2;
  const y = cy - h / 2;

  // Avoid overlap with other structures (AABB)
  for (const s of this.structures) {
    if (x < s.x + s.w && x + w > s.x && y < s.y + s.h && y + h > s.y) return false;
  }

  // Avoid spawn too close to enemies (if any exist)
  for (const e of this.enemies) {
    const dx = e.x - cx;
    const dy = e.y - cy;
    if (dx * dx + dy * dy < 120 * 120) return false;
  }

  this.structures.push(new Structure(x, y, w, h, type, hp));
  return true;
}

private circleIntersectsRect(cx: number, cy: number, r: number, s: Structure) {
  const nx = Math.max(s.x, Math.min(cx, s.x + s.w));
  const ny = Math.max(s.y, Math.min(cy, s.y + s.h));
  const dx = cx - nx;
  const dy = cy - ny;
  return (dx * dx + dy * dy) < (r * r);
}

private resolveCircleVsStructure(e: Enemy, s: Structure) {
  // Circle (enemy) vs AABB push-out along least penetration axis
  const cx = e.x;
  const cy = e.y;
  const r = e.radius;

  const left = s.x;
  const right = s.x + s.w;
  const top = s.y;
  const bottom = s.y + s.h;

  const nx = Math.max(left, Math.min(cx, right));
  const ny = Math.max(top, Math.min(cy, bottom));

  let dx = cx - nx;
  let dy = cy - ny;

  // If center is inside rect, push to nearest side
  if (dx === 0 && dy === 0) {
    const toL = cx - left;
    const toR = right - cx;
    const toT = cy - top;
    const toB = bottom - cy;
    const minSide = Math.min(toL, toR, toT, toB);

    if (minSide === toL) e.x = left - r;
    else if (minSide === toR) e.x = right + r;
    else if (minSide === toT) e.y = top - r;
    else e.y = bottom + r;

    return;
  }

  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  if (dist >= r) return;

  const push = (r - dist);
  dx /= dist;
  dy /= dist;

  e.x += dx * push;
  e.y += dy * push;
}


  update(dt: number) {
    if (this.gameState !== GameState.PLAYING && !this.isDemo) return;

    const now = Date.now();
    const dtMs = dt * 1000;
    const timeMult = (dt / 0.01666) * this.timeScale;

    // FX animation (spritesheet linha 0) - fps ~ 12, loop
    if (this.fxReady && this.fxCols > 0) {
      this.fxFrameAccMs += dtMs * timeMult;
      const frameMs = 1000 / this.fxFps;
      while (this.fxFrameAccMs >= frameMs) {
        this.fxFrameAccMs -= frameMs;
        this.fxFrame = (this.fxFrame + 1) % this.fxCols;
      }
    }

    if (dt > 0) {
      this.playerVx = (this.player.x - this.prevPlayerX) / dt;
      this.playerVy = (this.player.y - this.prevPlayerY) / dt;
    }
    
    if (now - this.lastRoundUpdate > (ROUND_DURATION / this.timeScale)) {
      this.round++;
      this.lastRoundUpdate = now;
      // Boss desativado (novo set de inimigos será adicionado em etapas)
    }

    if (this.stats.regenLevel > 0) {
      this.regenTimer -= dtMs * this.timeScale;
      if (this.regenTimer <= 0) { this.performRegen(); this.regenTimer = REGEN_INTERVAL; }
    }

    if (this.stats.shieldLevel > 0 && this.stats.shield < this.stats.maxShield) {
      if (now - this.lastDamageTime > 3000) {
        if (now - this.lastShieldTickTime > 200) { this.stats.shield = Math.min(this.stats.maxShield, this.stats.shield + 1); this.lastShieldTickTime = now; }
      }
    }

    if (this.invincibilityTimer > 0) this.invincibilityTimer -= dt;

    // Screen feedback timers
    if (this.damageFlashTime > 0) this.damageFlashTime = Math.max(0, this.damageFlashTime - dt);
    if (this.screenShakeTime > 0) {
      this.screenShakeTime = Math.max(0, this.screenShakeTime - dt);
      const t01 = Math.min(1, this.screenShakeTime / 0.16);
      const strength = this.screenShakeStrength * t01;
      this.screenShakeX = (Math.random() * 2 - 1) * strength;
      this.screenShakeY = (Math.random() * 2 - 1) * strength;
      if (this.screenShakeTime <= 0) {
        this.screenShakeStrength = 0;
        this.screenShakeX = 0;
        this.screenShakeY = 0;
      }
    }

    if (this.isDemo) {
      this.updateAutopilot(timeMult);
    } else {
      let inputX = 0, inputY = 0;
      if (this.joystick.active) {
        // Mobile joystick: clamp + deadzone + analog magnitude
        const jdx = this.joystick.current.x - this.joystick.base.x;
        const jdy = this.joystick.current.y - this.joystick.base.y;
        const maxDist = 70;
        const deadZone = 8;
        const dist = Math.sqrt(jdx * jdx + jdy * jdy);
        if (dist > deadZone) {
          const clamped = Math.min(dist, maxDist);
          const strength = clamped / maxDist; // 0..1
          inputX = (jdx / dist) * strength;
          inputY = (jdy / dist) * strength;
        }
      } else {
        if (this.keys.has('w') || this.keys.has('W') || this.keys.has('ArrowUp')) inputY -= 1;
        if (this.keys.has('s') || this.keys.has('S') || this.keys.has('ArrowDown')) inputY += 1;
        if (this.keys.has('a') || this.keys.has('A') || this.keys.has('ArrowLeft')) inputX -= 1;
        if (this.keys.has('d') || this.keys.has('D') || this.keys.has('ArrowRight')) inputX += 1;
      }
      if (this.keys.has('Shift')) this.triggerDash();
      const speedMult = (1 + this.stats.speedLevel * 0.04);
      const isDashing = this.dashTimer > 0;
      const moveSpeed = this.stats.speed * speedMult * (isDashing ? 3.0 : 1.0) * 0.72; // slower (menos rápido)
      const baseLerp = 0.22; // mais responsivo sem precisar de velocidade alta
      const lerpFactor = Math.min(1.0, baseLerp + (this.stats.handlingLevel * 0.07));
      if (inputX !== 0 || inputY !== 0) {
        const mag = Math.sqrt(inputX * inputX + inputY * inputY);
        // Keyboard gives mag≈1; joystick can be 0..1 (analog).
        const nx = inputX / mag;
        const ny = inputY / mag;
        const scaledSpeed = moveSpeed * Math.min(1, mag);
        const tx = nx * scaledSpeed;
        const ty = ny * scaledSpeed;
        this.playerVelX += (tx - this.playerVelX) * lerpFactor * timeMult;
        this.playerVelY += (ty - this.playerVelY) * lerpFactor * timeMult;
      } else {
        // "Ice" slide: keep moving with inertia after releasing input.
        // Use frame-rate-independent friction instead of instantly damping to zero.
        // Higher handling makes it a bit less slippery (more control), but still slides.
        const baseFriction = 0.95; // per 60fps frame (menor => para mais rápido)
        const friction = Math.max(0.86, baseFriction - this.stats.handlingLevel * 0.006);
        this.playerVelX *= Math.pow(friction, timeMult);
        this.playerVelY *= Math.pow(friction, timeMult);
        // Snap tiny drift to zero (avoids endless micro-sliding).
        if (Math.abs(this.playerVelX) < 0.02) this.playerVelX = 0;
        if (Math.abs(this.playerVelY) < 0.02) this.playerVelY = 0;
      }
      this.player.x += this.playerVelX * timeMult;
      this.player.y += this.playerVelY * timeMult;
      // Camera: always center on player (camera affects only render)
      this.cameraX = this.player.worldX - (this.viewW / this.cameraZoom) / 2;
      this.cameraY = this.player.worldY - (this.viewH / this.cameraZoom) / 2;
      if (isDashing) { this.dashTimer -= dt; if (Math.random() < 0.5) this.particles.emit(this.player.x, this.player.y, this.player.color, 1); }
      if (this.dashCooldown > 0) this.dashCooldown -= dt;
    }
    const hitboxReduction = Math.min(0.20, this.stats.hitboxLevel * 0.025);
    const playerHitRadius = this.player.radius * (1 - hitboxReduction);

    const takeDamage = (baseDmg: number, isBullet: boolean = false, mult: number = 1.0) => {
      if (this.godMode || this.invincibilityTimer > 0) return;
      this.lastDamageTime = Date.now();
      let dr = Math.min(0.3, this.stats.armorLevel * 0.03);
      if (isBullet) { const rangedDr = this.stats.bulletResistLevel * 0.03; dr = 1 - (1 - dr) * (1 - rangedDr); }
      let finalDamage = baseDmg * (1 - Math.min(0.8, dr)) * mult;
      if (this.stats.shield > 0) {
        if (this.stats.shield >= finalDamage) { this.stats.shield -= finalDamage; finalDamage = 0; }
        else { finalDamage -= this.stats.shield; this.stats.shield = 0; }
      }
      this.stats.hp -= finalDamage;
      if (this.stats.iFrameLevel >= 0) this.invincibilityTimer = Math.min(0.52, 0.22 + (this.stats.iFrameLevel * 0.04));
      if (finalDamage > 0) {
        this.particles.emit(this.player.x, this.player.y, '#ffffff', 5);
        const hpFrac = this.stats.maxHp > 0 ? (this.stats.hp / this.stats.maxHp) : 1;
        const lowMult = hpFrac < 0.25 ? 1.35 : 1.0;
        const shake = (3 + finalDamage * (isBullet ? 0.9 : 1.2)) * lowMult;
        this.addScreenShake(shake);
        this.triggerDamageFlash();
      }
    };

    if (this.stats.droneLevel > 0) {
      if (!this.drone) this.drone = new Drone(this.player.x, this.player.y);
      this.drone.update(this.player.x, this.player.y, timeMult);
      const droneShootCd = 900 / (1 + (this.stats.droneLevel - 1) * 0.08) / this.timeScale;
      if (now - this.lastDroneShoot > droneShootCd) { this.droneShoot(); this.lastDroneShoot = now; }
    }

    if (this.stats.fearLevel > 0 && now - this.lastFearPulse > 10000 / this.timeScale) { this.triggerFear(); this.lastFearPulse = now; }
    if (this.stats.freezeLevel > 0 && now - this.lastFreezePulse > 12000 / this.timeScale) { this.triggerFreeze(); this.lastFreezePulse = now; }
    if (this.stats.auraLevel > 0 && now - this.lastAuraTick > 200 / this.timeScale) { this.triggerAura(); this.lastAuraTick = now; }
    const pulseCd = 8000 * (1 - this.stats.pulseLevel * 0.04) / this.timeScale;
    if (this.stats.pulseLevel > 0 && now - this.lastPulseTime > pulseCd) { this.triggerPulse(); this.lastPulseTime = now; this.pulseVisualTimer = 400; }
    if (this.pulseVisualTimer > 0) this.pulseVisualTimer -= dtMs;

    if (this.boss && !this.isDemo) {
      this.boss.updateAI(this.player.x, this.player.y, dtMs, timeMult, (tx, ty) => {
        if (this.enemyBullets.length > 220) return;
        const bossBulletDmgMult = this.isDemo ? 1 : (1 + (this.round - 1) * 0.015 + Math.max(0, this.round - 20) * 0.008);
        this.enemyBullets.push(new EnemyBullet(this.boss!.x, this.boss!.y, tx, ty, 6 * bossBulletDmgMult, 'rgba(255, 60, 120, 0.95)', 10.5));
      });
      if (this.boss.checkLaserHit(this.player.x, this.player.y)) takeDamage(2, false, timeMult);
    }

    // ------------------------------
    // Balance: dynamic cap + smoother spawn curve
    // - Prevents "100 enemies dogpile" at higher rounds.
    // - Keeps challenge, but lets the player actually kill and also die if pinned.
    // ------------------------------
    const dynamicCap = 22 + Math.floor(this.round * 1.35); // ~58 at round 27
    const enemyLimit = this.isDemo ? 25 : Math.min(MAX_ENEMIES, dynamicCap);

    // Spawn rate decreases slowly (not instantly hitting 500ms).
    // ~1.2-1.4 spawns/sec at high rounds instead of 2+/sec.
    let spawnRate = this.isDemo ? 1200 : Math.max(450, 1100 - this.round * 24);

    // If too many enemies are already close to the player, slow spawns a bit (anti-dogpile).
    if (!this.isDemo && this.enemies.length > 10) {
      let close = 0;
      for (const e of this.enemies) {
        const dx = e.x - this.player.x;
        const dy = e.y - this.player.y;
        if (dx * dx + dy * dy < 170 * 170) close++;
      }
      if (close >= 10) spawnRate *= 1.35;
      else if (close >= 7) spawnRate *= 1.18;
    }

    if (this.spawningEnabled && now - this.lastEnemySpawn > (spawnRate / this.timeScale)) {
      if (this.enemies.length < enemyLimit) {
        this.spawnEnemy();
        this.lastEnemySpawn = now;
      }
    }
    this.maintainStructures(now);
    if (now - this.lastShoot > (500 / this.stats.attackSpeed / this.timeScale)) { this.autoShoot(); this.lastShoot = now; }

    this.bullets.forEach(b => b.update(timeMult));
    this.enemyBullets.forEach(b => b.update(timeMult));

    // Enemy bullets get slightly stronger as rounds increase (keeps pressure in late game).
    const enemyBulletDmgMult = this.isDemo ? 1 : (1 + (this.round - 1) * 0.015 + Math.max(0, this.round - 20) * 0.008);

    const smartCtx = {
      dtMs, timeMult, playerVx: this.playerVx, playerVy: this.playerVy, width: this.viewW / this.cameraZoom, height: this.viewH / this.cameraZoom, enemies: this.enemies,
      spawnEnemyBullet: (x: number, y: number, tx: number, ty: number, damage: number, speed?: number) => {
        if (this.enemyBullets.length > 220) return;
        this.enemyBullets.push(new EnemyBullet(x, y, tx, ty, damage * enemyBulletDmgMult, undefined, speed));
      },
      spawnMinion: (x: number, y: number, hp: number, speed: number) => {
        if (this.enemies.length >= enemyLimit) return;
        this.enemies.push(new Enemy(x, y, hp, speed));
      }
    };

    this.enemies.forEach(e => {
      const anyE = e as any;
      if (typeof anyE.updateSmart === 'function') anyE.updateSmart(this.player.x, this.player.y, smartCtx);
      else e.update(this.player.x, this.player.y, timeMult);
    });

    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i];
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j];
        const dx = b.x - a.x, dy = b.y - a.y, rr = a.radius + b.radius, d2 = dx * dx + dy * dy;
        if (d2 > 0.0001 && d2 < rr * rr) {
          const d = Math.sqrt(d2), push = (rr - d) * 0.52, nx = dx / d, ny = dy / d;
          a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
        }
      }
    }
// Structures: coberturas físicas (opção A) - bloqueiam inimigos, quebram e dropam cura
if (this.structures.length > 0) {
  const dtSec = (dtMs * this.timeScale) / 1000;
  const contactCounts = new Array(this.structures.length).fill(0);

  for (const e of this.enemies) {
    for (let si = 0; si < this.structures.length; si++) {
      const s = this.structures[si];
      if (this.circleIntersectsRect(e.x, e.y, e.radius, s)) {
        contactCounts[si] += 1;
        this.resolveCircleVsStructure(e, s);
      }
    }
  }

  // Apply DPS + break (loop backwards to safely splice)
  for (let i = this.structures.length - 1; i >= 0; i--) {
    const s = this.structures[i];
    const cnt = contactCounts[i] || 0;
    if (cnt > 0) {
      s.hp -= this.structureDamageDpsPerEnemy * cnt * dtSec;
    }
    if (s.hp <= 0) {
      // Break FX
      this.particles.emit(s.cx, s.cy, '#EAFBFF', 10);

      // Drop heal (70/25/5)
      const r = Math.random();
      let heal = 0.10;
      if (r < 0.05) heal = 0.50;
      else if (r < 0.30) heal = 0.25;

      this.healthPickups.push(new HealthPickup(s.cx, s.cy, heal, 14));
      this.structures.splice(i, 1);
    }
  }
}

// Health pickups: lifetime + collect (player atravessa estruturas)
if (this.healthPickups.length > 0) {
  const dtPickupMs = dtMs * this.timeScale;
  for (const p of this.healthPickups) p.update(dtPickupMs);

  const pr = this.player.radius;
  this.healthPickups = this.healthPickups.filter(p => {
    if (p.expired) return false;
    const dx = p.x - this.player.x, dy = p.y - this.player.y;
    if (dx * dx + dy * dy < (p.radius + pr) * (p.radius + pr)) {
      // heal
      this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + this.stats.maxHp * p.healPercent);
      this.particles.emit(p.x, p.y, '#9CFFB3', 7);
      return false;
    }
    return true;
  });
}

this.particles.update(timeMult);
    this.damageNumbers.forEach(n => n.update(dtMs * this.timeScale));
    this.damageNumbers = this.damageNumbers.filter(n => !n.done);

    const wView = this.viewW / this.cameraZoom;
    const hView = this.viewH / this.cameraZoom;
    const cullPad = 420;
    const camX = this.cameraX;
    const camY = this.cameraY;

    this.bullets = this.bullets.filter(b => {
      let active = true;
      if (this.boss && !this.isDemo) {
        const dxb = this.boss.x - b.x, dyb = this.boss.y - b.y;
        if (dxb * dxb + dyb * dyb < (this.boss.radius + b.radius)**2) {
          const dmg = b.damage * (this.boss.bossState === 'VULNERABLE' ? 1.5 : 1.0);
          this.boss.hp -= dmg;
          this.spawnDamageNumber(this.boss.x, this.boss.y - this.boss.radius, dmg, '#FFD6FF');
          this.particles.emit(b.x, b.y, b.color, 3);
          if (this.stats.slowLevel > 0) { this.boss.slowMs = 1200; this.boss.slowIntensity = this.stats.slowLevel * 0.05; }
          if (this.stats.burnLevel > 0) { this.boss.burnMs = 600 + this.stats.burnLevel * 160; this.boss.burnDmgPerTick = this.stats.damage * 0.03; }
          if (this.boss.hp <= 0) this.killBoss();
          return false;
        }
      }
      for (const e of this.enemies) {
        const dx = e.x - b.x, dy = e.y - b.y;
        if (dx * dx + dy * dy < (e.radius + b.radius)**2) {
          const dmg = e.shieldMs > 0 ? b.damage * 0.6 : b.damage;
          e.hp -= dmg;
          this.spawnDamageNumber(e.x, e.y - e.radius, dmg, e.shieldMs > 0 ? '#B9D6FF' : '#EAFBFF');
          const bDist = Math.sqrt(b.vx * b.vx + b.vy * b.vy) || 1;
          const kbForce = (this.stats.knockback + (this.stats.knockbackLevel * 0.1)) * 8;
          const anyE = e as any;
          const kbMult = typeof anyE.kbMult === 'number' ? anyE.kbMult : 1;
          e.x += (b.vx / bDist) * kbForce * kbMult * (b as any).kbMult;
          e.y += (b.vy / bDist) * kbForce * kbMult * (b as any).kbMult;
          this.particles.emit(b.x, b.y, b.color, 3);
          (e as any).hitFlashMs = 110;
          if (this.stats.slowLevel > 0) { e.slowMs = 1200; e.slowIntensity = this.stats.slowLevel * 0.04; }
          if (this.stats.burnLevel > 0) { e.burnMs = 600 + this.stats.burnLevel * 160; e.burnDmgPerTick = this.stats.damage * 0.03; }
          if ((b as any).pierce > 0) { (b as any).pierce--; active = true; } else { active = false; } break;
        }
      }
      return active && b.x > (camX - cullPad) && b.x < (camX + wView + cullPad) && b.y > (camY - cullPad) && b.y < (camY + hView + cullPad);
    });

    this.enemyBullets = this.enemyBullets.filter(b => {
      const dx = b.x - this.player.x, dy = b.y - this.player.y;
      if (Math.sqrt(dx * dx + dy * dy) < (playerHitRadius + b.radius)) {
        takeDamage(b.damage, true, timeMult);
        this.particles.emit(b.x, b.y, 'rgba(255, 160, 0, 0.9)', 6);
        return false;
      }
      return b.x > (camX - cullPad) && b.x < (camX + wView + cullPad) && b.y > (camY - cullPad) && b.y < (camY + hView + cullPad);
    });

    this.enemies = this.enemies.filter(e => {
      if (e.hp <= 0) {
        const anyE = e as any;
        // Death VFX
        if (anyE.deathVfx === 'mini') {
          this.particles.emit(e.x, e.y, anyE.deathVfxColor || e.color, anyE.deathVfxCount || 12);
        } else {
          this.particles.emit(e.x, e.y, e.color, 10);
        }

        // XP drop (per enemy)
        const xpChance = typeof anyE.xpDropChance === 'number' ? anyE.xpDropChance : 1;
        const xpValue = typeof anyE.xpDropValue === 'number' ? anyE.xpDropValue : 10;
        if (Math.random() < xpChance) this.dropXp(e.x, e.y, xpValue);
        if (!this.isDemo) {
          this.stats.coins += Math.floor(2 * (1 + this.stats.creditsLevel * 0.08));
          if (this.stats.healOnKillLevel > 0) {
            const healPerc = 0.01 + (this.stats.healOnKillLevel - 1) * 0.005;
            this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + this.stats.maxHp * healPerc);
          }
        }
        return false;
      }
      return true;
    });

    if (!this.isDemo) {
      // Contact damage
// - Default enemies: light per-frame contact damage (legacy)
// - Drone Enxame: ticked contact damage (6 DPS => 1 dmg / ~170ms) while touching
const contactBase = 0.95 + this.round * 0.028;
const dashBase = 2.6 + this.round * 0.055;

this.enemies.forEach(e => {
  const dx = e.x - this.player.x, dy = e.y - this.player.y;
  if (Math.sqrt(dx * dx + dy * dy) < (e.radius + playerHitRadius)) {
    const anyE = e as any;

    if (typeof anyE.contactTickMs === 'number' && typeof anyE.contactDamage === 'number') {
      anyE.contactAccMs = (anyE.contactAccMs || 0) + dtMs;
      while (anyE.contactAccMs >= anyE.contactTickMs) {
        takeDamage(anyE.contactDamage, false, timeMult);
        anyE.contactAccMs -= anyE.contactTickMs;
      }
    } else {
      takeDamage((anyE.dashMs && anyE.dashMs > 0) ? dashBase : contactBase, false, timeMult);
    }
  } else {
    const anyE = e as any;
    if (anyE.contactAccMs) anyE.contactAccMs = 0;
  }
});

// Boss contact disabled for now (novo set de inimigos em etapas)
if (this.stats.hp <= 0) { this.gameState = GameState.GAME_OVER; this.onGameOver(this.stats.coins); }
    } else if (this.isDemo && this.stats.hp < this.stats.maxHp * 0.2) this.stats.hp = this.stats.maxHp;

    this.xpCrystals = this.xpCrystals.filter(xp => {
      xp.update(dtMs, timeMult);
      const dx = xp.x - this.player.x, dy = xp.y - this.player.y, d = Math.sqrt(dx * dx + dy * dy);
      const magRange = this.stats.range * (1 + this.stats.magnetLevel * 0.07);
      if (xp.age > xp.magnetDelay && d < magRange) {
        const force = 0.5 * (1 + (xp.age - xp.magnetDelay) * 0.002) * (1 + this.stats.pullSpeedLevel * 0.10);
        xp.vx -= (dx / d) * force * timeMult; xp.vy -= (dy / d) * force * timeMult;
      }
      if (d < playerHitRadius + xp.radius) {
        if (!this.isDemo) { 
          AudioService.playPickupSfx(); 
          if (!xp.isFake) this.addXp(xp.value); 
        }
        this.particles.emit(this.player.x, this.player.y, xp.color, 3);
        return false;
      }
      return true;
    });

    for (const e of this.enemies) {
      const anyE = e as any;
      if (anyE.getArmingMs && anyE.consumeExplosion) {
        if (anyE.getArmingMs() === 0 && !anyE.__explodedOnce) {
          anyE.__explodedOnce = true;
          this.particles.emit(e.x, e.y, 'rgba(255,120,0,0.9)', 35);
          const ddx = e.x - this.player.x, ddy = e.y - this.player.y;
          if (Math.sqrt(ddx * ddx + ddy * ddy) < (70 + playerHitRadius)) takeDamage(18);
          anyE.consumeExplosion();
        }
        if (anyE.getArmingMs() > 0) anyE.__explodedOnce = false;
      }
    }
    this.prevPlayerX = this.player.x; this.prevPlayerY = this.player.y;
  }

  triggerAura() {
    const radius = 36 + this.stats.auraLevel * 2.2;
    const auraDmg = Math.max(1, this.stats.damage * 0.06);
    const apply = (e: Enemy) => {
      const dx = e.x - this.player.x, dy = e.y - this.player.y;
      if (Math.sqrt(dx * dx + dy * dy) < radius + e.radius) {
        e.hp -= auraDmg; this.spawnDamageNumber(e.x, e.y - e.radius, auraDmg, '#FFCFA6'); (e as any).hitFlashMs = Math.max((e as any).hitFlashMs || 0, 50);
        if (this.stats.slowLevel > 0) { e.slowMs = 500; e.slowIntensity = this.stats.slowLevel * 0.02; }
        if (this.stats.burnLevel > 0) { e.burnMs = 400; e.burnDmgPerTick = this.stats.damage * 0.015; }
      }
    };
    this.enemies.forEach(apply);
    if (this.boss) apply(this.boss as any);
  }

  triggerPulse() {
    const radius = 140, pulseDmg = Math.max(5, this.stats.damage * 0.22);
    const apply = (e: Enemy) => {
      const dx = e.x - this.player.x, dy = e.y - this.player.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < radius) {
        e.hp -= pulseDmg; this.spawnDamageNumber(e.x, e.y - e.radius, pulseDmg, '#FFFFFF'); e.x += (dx / (d || 1)) * 35; e.y += (dy / (d || 1)) * 35; (e as any).hitFlashMs = 110;
        if (this.stats.slowLevel > 0) { e.slowMs = 2000; e.slowIntensity = this.stats.slowLevel * 0.06; }
      }
    };
    this.enemies.forEach(apply);
    if (this.boss) apply(this.boss as any);
    this.particles.emit(this.player.x, this.player.y, '#ffffff', 25);
  }

  triggerFear() {
    const r = 180, dur = 700 + this.stats.fearLevel * 100;
    this.enemies.forEach(e => {
      const dx = e.x - this.player.x, dy = e.y - this.player.y;
      if (Math.sqrt(dx * dx + dy * dy) < r) e.fearMs = dur;
    });
    this.particles.emit(this.player.x, this.player.y, '#ff00ff', 20);
  }

  triggerFreeze() {
    const r = 220, dur = 600 + this.stats.freezeLevel * 100;
    this.enemies.forEach(e => {
      const dx = e.x - this.player.x, dy = e.y - this.player.y;
      if (Math.sqrt(dx * dx + dy * dy) < r) e.freezeMs = dur;
    });
    this.particles.emit(this.player.x, this.player.y, '#6ef7ff', 30);
  }
droneShoot() {
  let closest: Enemy | null = null, minDist = Infinity;

  // Drone só mira em inimigos VISÍVEIS na tela
  const w = this.viewW / this.cameraZoom;
  const h = this.viewH / this.cameraZoom;
  const camX = this.cameraX;
  const camY = this.cameraY;
  const margin = 120;
  const playerShootRange = 160; // px (curto)

  const targets = this.boss ? [this.boss as any, ...this.enemies] : this.enemies;
  for (const e of targets) {
    const sx = e.x - camX;
    const sy = e.y - camY;
    if (sx < -margin || sx > w + margin || sy < -margin || sy > h + margin) continue;

    const dxp = e.x - this.player.x, dyp = e.y - this.player.y;
    const dToPlayer = Math.sqrt(dxp * dxp + dyp * dyp);
    if (dToPlayer > playerShootRange) continue;

    const dx = e.x - this.drone!.x, dy = e.y - this.drone!.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < minDist) { minDist = d; closest = e; }
  }
  if (closest) {
    const dmg = this.stats.damage * (0.35 + this.stats.droneLevel * 0.07);
    this.bullets.push(new Bullet(this.drone!.x, this.drone!.y, closest.x, closest.y, dmg, '#00ffcc'));
  }
}

  dropXp(x: number, y: number, value: number) {
    if (this.xpCrystals.length > 500) return;
    let totalOrbs = this.isDemo ? 1 : Math.floor(Math.random() * 3) + 2;
    if (!this.isDemo && Math.random() < (this.stats.extraOrbChanceLevel * 0.06)) totalOrbs++;
    const divisor = Math.max(1, 5 - this.stats.realOrbAffinity * 2);
    const realCount = this.isDemo ? 0 : Math.min(totalOrbs, 1 + Math.floor((Math.max(1, this.stats.level) - 1) / divisor));
    
    // XP Progression logic:
    // Base boost +20% (1.2)
    // Catch-up boost if no level up for 25s (+50% / 1.5x)
    let multiplier = 1.15 * (1 + this.stats.xpGainLevel * 0.06);
    if (!this.isDemo && (Date.now() - this.lastLevelUpTime) > 25000) {
      multiplier *= 1.5;
    }

    const adjustedValue = value * multiplier;
    for (let i = 0; i < totalOrbs; i++) {
      const isFake = i >= realCount;
      this.xpCrystals.push(new ExperienceCrystal(x, y, isFake ? 0 : adjustedValue, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, isFake));
    }
  }

  performRegen() {
    if (this.stats.hp < this.stats.maxHp && this.stats.regenLevel > 0) {
      const perc = Math.min(0.12, 0.006 + this.stats.regenLevel * 0.009);
      this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + this.stats.maxHp * perc);
      if (!this.isDemo) this.particles.emit(this.player.x, this.player.y, '#00ff00', 5);
    }
  }

  killAllMinions() { this.enemies.forEach(e => { this.particles.emit(e.x, e.y, e.color, 5); this.dropXp(e.x, e.y, 10); }); this.enemies = []; }

  addXp(amount: number) {
    this.stats.xp += amount;
    if (this.stats.xp >= this.stats.nextLevelXp) {
      this.stats.level++; 
      this.stats.xp = 0;
      this.lastLevelUpTime = Date.now();
      // Curva de XP reduzida: 1.25x em vez de 1.5x
      this.stats.nextLevelXp = Math.floor(this.stats.nextLevelXp * 1.25);
      this.gameState = GameState.LEVEL_UP; 
      this.onLevelUp();
    }
  }

  spawnEnemy() {
  // Mundo: spawn bem perto fora da viewport (pra inimigos entrarem e serem vistos)
  const w = this.viewW / this.cameraZoom;
  const h = this.viewH / this.cameraZoom;

  const px = this.player.worldX;
  const py = this.player.worldY;

  const margin = 40; // quão "fora da tela" nasce
  const side = (Math.random() * 4) | 0;

  let x = px;
  let y = py;

  if (side === 0) { // left
    x = px - (w / 2 + margin);
    y = py + (Math.random() - 0.5) * (h + margin * 2);
  } else if (side === 1) { // right
    x = px + (w / 2 + margin);
    y = py + (Math.random() - 0.5) * (h + margin * 2);
  } else if (side === 2) { // top
    x = px + (Math.random() - 0.5) * (w + margin * 2);
    y = py - (h / 2 + margin);
  } else { // bottom
    x = px + (Math.random() - 0.5) * (w + margin * 2);
    y = py + (h / 2 + margin);
  }

  const countType = (klass: any) => this.enemies.filter(e => e instanceof klass).length;

  // Drone Enxame (Kamikaze) - vem MUITO
  const roundOver20 = Math.max(0, this.round - 20);
  const droneHp = 16 * (1 + (this.round - 1) * 0.035 + roundOver20 * 0.010);
  const speedBase = 1.15 + (this.round * 0.032);
  const speedScale = 1 + (this.round - 1) * 0.006 + roundOver20 * 0.002;
  const droneSpeed = Math.min(4.2, speedBase * speedScale * 1.35);

  // Caça Atirador (Burst 3x) - ranged comum/elite leve
  const shooterHp = 40 * (1 + (this.round - 1) * 0.030 + roundOver20 * 0.010);
  const shooterSpeed = Math.min(3.2, (1.05 + this.round * 0.028) * 0.95);

  // Chance aumenta levemente com a rodada, mas Drone continua maioria
  const shooterCap = 4;
  const shooterChance = Math.min(0.22, 0.10 + this.round * 0.008);

  if (this.round >= 2 && countType(BurstHunterEnemy) < shooterCap && Math.random() < shooterChance) {
    this.enemies.push(new BurstHunterEnemy(x, y, shooterHp, shooterSpeed));
  } else {
    this.enemies.push(new DroneSwarmEnemy(x, y, droneHp, droneSpeed));
  }
}

  spawnBoss() { this.spawningEnabled = false; this.killAllMinions(); this.boss = new Boss(this.viewW / 2, -100, 5000 + this.round * 500); }

  killBoss() {
    if (!this.boss) return; this.particles.emit(this.boss.x, this.boss.y, this.boss.color, 100);
    for (let i = 0; i < 20; i++) this.dropXp(this.boss.x + (Math.random() - 0.5) * 100, this.boss.y + (Math.random() - 0.5) * 100, 50);
    this.stats.coins += Math.floor(500 * (1 + this.stats.creditsLevel * 0.08));
    this.boss = null; this.spawningEnabled = true;
  }
autoShoot() {
  let closest: Entity | null = null, minDist = Infinity;

  // Só atira em alvos VISÍVEIS na tela (evita matar inimigos fora da tela)
  const w = this.viewW / this.cameraZoom;
  const h = this.viewH / this.cameraZoom;
  const camX = this.cameraX;
  const camY = this.cameraY;
  const margin = 80;
  const playerShootRange = 160; // px (curto)

  const targets = this.boss ? [this.boss as any, ...this.enemies] : this.enemies;
  for (const e of targets) {
    const sx = e.x - camX;
    const sy = e.y - camY;
    if (sx < -margin || sx > w + margin || sy < -margin || sy > h + margin) continue;

    const dx = e.x - this.player.x, dy = e.y - this.player.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < minDist) { minDist = d; closest = e; }
  }

  if (closest && minDist <= playerShootRange) {
    if (!this.isDemo) AudioService.playShootSfx();

    // 1) Canhão Gauss (arma principal)
    const gaussLevel = (this.stats as any).gaussLevel ?? 1;
    let pierce = 0;
    if (gaussLevel >= 4) pierce += 1;
    if (gaussLevel >= 7) pierce += 1;


    const kbMult = 1.0;
    const speed = 16; // projétil rápido e preciso
    const color = undefined;

    const baseAngle = Math.atan2(closest.y - this.player.y, closest.x - this.player.x);
    const totalSpread = 0.15 * (this.stats.multiShot - 1);
    const startAngle = baseAngle - totalSpread / 2;

    for (let i = 0; i < this.stats.multiShot; i++) {
      const angle = startAngle + (i * 0.15) + (Math.random() - 0.5) * this.stats.accuracy;
      const dmg = 3; // FIXO
      this.bullets.push(
        new Bullet(
          this.player.x,
          this.player.y,
          this.player.x + Math.cos(angle) * 1000,
          this.player.y + Math.sin(angle) * 1000,
          dmg,
          color,
          speed,
          pierce,
          kbMult
        )
      );
    }
  }
}

  draw() {
    const w = this.viewW;
    const h = this.viewH;
    // Mundo: câmera segue o player (player fica no centro da tela)
    const camX = this.cameraX;
    const camY = this.cameraY;

    // High-DPI: map CSS pixels -> device pixels (controlled by dpr cap in UI settings)
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Suavização ajuda quando o zoom não é 1 (principalmente em celular) para não ficar muito "pixelizado"
    const smooth = this.cameraZoom < 0.95;
    this.ctx.imageSmoothingEnabled = smooth;
    try { (this.ctx as any).imageSmoothingQuality = smooth ? 'high' : 'low'; } catch {}

    // Frame limpo (sem motion blur / ghost). Limpa 100% antes de desenhar.
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = 1;
    this.ctx.clearRect(0, 0, w, h);

    // Screen shake
    this.ctx.save();
    this.ctx.translate(this.screenShakeX, this.screenShakeY);
    // World render: aplica câmera só no desenho
    this.ctx.save();
    this.ctx.scale(this.cameraZoom, this.cameraZoom);
    this.ctx.translate(-camX, -camY);


    // Chão/ambiente: desenhar EM WORLD SPACE (mesma câmera/zoom das entidades)
    // Isso evita o 'escorregamento' onde o piso parece mover em outra velocidade.
    if (this.floorPattern && this.floorTileW > 0 && this.floorTileH > 0) {
      const tw = this.floorTileW;
      const th = this.floorTileH;
      const vw = w / this.cameraZoom;
      const vh = h / this.cameraZoom;
      this.ctx.save();
      this.ctx.globalAlpha = 0.35;
      this.ctx.fillStyle = this.floorPattern;
      // Cobrir apenas a área visível (em world units) + margem
      this.ctx.fillRect(camX - tw * 2, camY - th * 2, vw + tw * 4, vh + th * 4);
      this.ctx.restore();
    } else {
      // Fallback: grid em world space
      this.ctx.save();
      this.ctx.strokeStyle = COLORS.GRID;
      this.ctx.lineWidth = 1;
      const step = 50;
      const vw = w / this.cameraZoom;
      const vh = h / this.cameraZoom;
      const startX = Math.floor(camX / step) * step;
      const startY = Math.floor(camY / step) * step;
      const endX = camX + vw + step;
      const endY = camY + vh + step;
      for (let x = startX; x <= endX; x += step) {
        this.ctx.beginPath();
        this.ctx.moveTo(x, camY - 120);
        this.ctx.lineTo(x, camY + vh + 120);
        this.ctx.stroke();
      }
      for (let y = startY; y <= endY; y += step) {
        this.ctx.beginPath();
        this.ctx.moveTo(camX - 120, y);
        this.ctx.lineTo(camX + vw + 120, y);
        this.ctx.stroke();
      }
      this.ctx.restore();
    }

if (this.stats.auraLevel > 0) {
      const radius = 36 + this.stats.auraLevel * 2.2;
      this.ctx.save(); this.ctx.strokeStyle = 'rgba(255, 120, 0, 0.15)'; this.ctx.lineWidth = 2; this.ctx.shadowBlur = 10; this.ctx.shadowColor = 'rgba(255, 120, 0, 0.4)';
      this.ctx.beginPath(); this.ctx.arc(this.player.x, this.player.y, Math.max(0, radius), 0, Math.PI * 2); this.ctx.stroke(); this.ctx.restore();
    }
    if (this.pulseVisualTimer > 0) {
      const t = 1 - this.pulseVisualTimer / 400;
      this.ctx.save(); this.ctx.strokeStyle = `rgba(255, 255, 255, ${0.4 * (1 - t)})`; this.ctx.lineWidth = 4;
      this.ctx.beginPath(); this.ctx.arc(this.player.x, this.player.y, Math.max(0, 140 * t), 0, Math.PI * 2); this.ctx.stroke(); this.ctx.restore();
    }
    if (this.stats.fearLevel > 0) {
      const tFear = Math.max(0, (Date.now() - this.lastFearPulse) / (10000 / this.timeScale));
      if (tFear < 0.1) {
        this.ctx.save(); this.ctx.strokeStyle = `rgba(255, 0, 255, ${0.3 * (1 - tFear*10)})`; this.ctx.lineWidth = 4;
        this.ctx.beginPath(); this.ctx.arc(this.player.x, this.player.y, Math.max(0, 180 * tFear * 10), 0, Math.PI * 2); this.ctx.stroke(); this.ctx.restore();
      }
    }
    if (this.stats.freezeLevel > 0) {
      const tFreeze = Math.max(0, (Date.now() - this.lastFreezePulse) / (12000 / this.timeScale));
      if (tFreeze > 0.95) {
         const tTele = (tFreeze - 0.95) / 0.05;
         this.ctx.save(); this.ctx.strokeStyle = `rgba(110, 247, 255, ${0.1 + tTele * 0.2})`; this.ctx.setLineDash([5, 5]);
         this.ctx.beginPath(); this.ctx.arc(this.player.x, this.player.y, Math.max(0, 220), 0, Math.PI * 2); this.ctx.stroke(); this.ctx.restore();
      }
    }
// Sombras + desenho do mundo (leve, sem shadowBlur pesado)
// Estruturas de cobertura (bloqueiam inimigos) + pickups de cura
this.structures.forEach(s => {
  // shadow blob no chão
  const sr = Math.max(s.w, s.h) * 0.35;
  this.drawBlobShadow(this.ctx, s.cx, s.cy - s.h * 0.15, sr, 0.34);

  // placeholder sprite (retângulo)
  this.ctx.save();
  if (s.type === 'bush') this.ctx.fillStyle = 'rgba(60, 200, 120, 0.85)';
  else if (s.type === 'rock') this.ctx.fillStyle = 'rgba(150, 170, 185, 0.90)';
  else this.ctx.fillStyle = 'rgba(220, 170, 80, 0.90)';
  this.ctx.fillRect(s.x, s.y, s.w, s.h);
  this.ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  this.ctx.lineWidth = 1;
  this.ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);

  // HP bar (só quando danificado)
  if (s.hp < s.maxHp) {
    const barW = s.w;
    const barH = 4;
    const bx = s.x;
    const by = s.y - 7;
    this.ctx.fillStyle = 'rgba(0,0,0,0.55)';
    this.ctx.fillRect(bx, by, barW, barH);
    const t = Math.max(0, Math.min(1, s.hp / s.maxHp));
    this.ctx.fillStyle = 'rgba(180, 255, 220, 0.85)';
    this.ctx.fillRect(bx, by, barW * t, barH);
  }
  this.ctx.restore();
});

this.healthPickups.forEach(p => {
  this.drawBlobShadow(this.ctx, p.x, p.y, p.radius * 0.9, 0.22);
  this.ctx.save();
  const c = p.healPercent >= 0.5 ? 'rgba(255, 190, 190, 0.95)' : (p.healPercent >= 0.25 ? 'rgba(190, 255, 210, 0.95)' : 'rgba(170, 240, 255, 0.95)');
  this.ctx.fillStyle = c;
  this.ctx.beginPath();
  this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
  this.ctx.fill();
  this.ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  this.ctx.lineWidth = 2;
  this.ctx.stroke();
  this.ctx.restore();
});


this.xpCrystals.forEach(xp => {
  const sc = (xp as any).scale ?? 1;
  this.drawBlobShadow(this.ctx, xp.x, xp.y, xp.radius * sc, 0.22);
  xp.draw(this.ctx);
});

if (this.renderPlayerBullets2D) this.bullets.forEach(b => {
  this.drawBlobShadow(this.ctx, b.x, b.y, b.radius * 0.9, 0.18);
  b.draw(this.ctx);
});

this.enemyBullets.forEach(b => {
  this.drawBlobShadow(this.ctx, b.x, b.y, b.radius * 0.9, 0.18);
  b.draw(this.ctx);
});

this.enemies.forEach(e => {
  this.drawBlobShadow(this.ctx, e.x, e.y, e.radius, 0.32);
  e.draw(this.ctx);
});

if (this.boss) {
  this.drawBlobShadow(this.ctx, this.boss.x, this.boss.y, this.boss.radius * 1.15, 0.35);
  this.boss.draw(this.ctx);
}

if (this.drone) {
  this.drawBlobShadow(this.ctx, this.drone.x, this.drone.y, this.drone.radius, 0.24);
  this.drone.draw(this.ctx);
}

// Player shadow no chão (antes do FX, pra não "tampar" o efeito)
this.drawBlobShadow(this.ctx, this.player.x, this.player.y, this.player.radius * 1.05, 0.34);

// FX no chão (por baixo do player) - spritesheet linha 0 (32x32), com scale
if (this.fxImage && this.fxImage.complete && this.fxImage.naturalWidth > 0) {
  const fw = 32, fh = 32;
  const cols = this.fxCols || Math.max(1, Math.floor((this.fxImage.naturalWidth || this.fxImage.width) / fw));
  const frame = (this.fxFrame % cols + cols) % cols;
  const sx = frame * fw;
  const sy = 0; // linha 0

  // segurança: não recortar fora da imagem
  if (sx + fw <= (this.fxImage.naturalWidth || this.fxImage.width)) {
    const scale = 1.6;
    const dw = fw * scale;
    const dh = fh * scale;

    // posiciona no "pé" do player
    const playerHalfH = this.player.radius * 1.5; // player sprite ~ radius*3
    const offsetY = 10;

    const fxWorldX = this.player.x - dw / 2;
    const fxWorldY = this.player.y + playerHalfH - dh / 2 + offsetY;

    this.ctx.drawImage(this.fxImage, sx, sy, fw, fh, fxWorldX, fxWorldY, dw, dh);
  }
}

    if (this.invincibilityTimer <= 0 || Math.floor(Date.now() / 50) % 2 === 0) this.player.draw(this.ctx);
    this.particles.draw(this.ctx);
    this.damageNumbers.forEach(n => n.draw(this.ctx));
    this.ctx.restore();
    this.ctx.restore();
    if (this.joystick.active && !this.isDemo) {
      const { base, current } = this.joystick;
      const jdx = current.x - base.x;
      const jdy = current.y - base.y;
      const maxDist = 70;
      const dist = Math.sqrt(jdx * jdx + jdy * jdy) || 1;
      const clamped = Math.min(dist, maxDist);
      const stickX = base.x + (jdx / dist) * clamped;
      const stickY = base.y + (jdy / dist) * clamped;

      this.ctx.save();
      this.ctx.globalAlpha = 0.7;
      this.ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.arc(base.x, base.y, maxDist, 0, Math.PI * 2);
      this.ctx.stroke();

      this.ctx.globalAlpha = 0.55;
      this.ctx.strokeStyle = this.player.color;
      this.ctx.shadowBlur = 18;
      this.ctx.shadowColor = this.player.color;
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.arc(base.x, base.y, maxDist, 0, Math.PI * 2);
      this.ctx.stroke();

      this.ctx.shadowBlur = 25;
      this.ctx.globalAlpha = 0.65;
      this.ctx.fillStyle = 'rgba(255,255,255,0.08)';
      this.ctx.beginPath();
      this.ctx.arc(stickX, stickY, 20, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.globalAlpha = 0.9;
      this.ctx.fillStyle = this.player.color;
      this.ctx.beginPath();
      this.ctx.arc(stickX, stickY, 12, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.restore();
    }
    // Screen feedback overlay (not relying only on the HP bar)
    // 1) Instant damage flash
    if (this.damageFlashTime > 0) {
      const a = Math.min(0.35, (this.damageFlashTime / 0.12) * 0.28);
      this.ctx.save();
      this.ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
      this.ctx.fillRect(0, 0, w, h);
      this.ctx.restore();
    }

    // 2) Low HP warning: red vignette + pulse as HP gets low
    const hpFrac = this.stats.maxHp > 0 ? (this.stats.hp / this.stats.maxHp) : 1;
    if (!this.isDemo && hpFrac < 0.35) {
      const danger = Math.min(1, Math.max(0, (0.35 - hpFrac) / 0.35)); // 0..1
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 130);
      const baseAlpha = 0.10 + 0.22 * danger; // up to ~0.32
      const a = baseAlpha * (0.65 + 0.35 * pulse);

      // soft red tint
      this.ctx.save();
      this.ctx.fillStyle = `rgba(255, 40, 70, ${a * 0.35})`;
      this.ctx.fillRect(0, 0, w, h);

      // vignette
      const g = this.ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.15, w / 2, h / 2, Math.max(w, h) * 0.65);
      g.addColorStop(0, `rgba(255, 40, 70, 0)`);
      g.addColorStop(1, `rgba(255, 40, 70, ${a})`);
      this.ctx.fillStyle = g;
      this.ctx.fillRect(0, 0, w, h);

      // subtle "heartbeat" ring when very low
      if (hpFrac < 0.18) {
        const rr = (0.25 + 0.25 * pulse) * Math.max(w, h);
        this.ctx.strokeStyle = `rgba(255, 60, 90, ${a * 0.6})`;
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.arc(w / 2, h / 2, rr * 0.05, 0, Math.PI * 2);
        this.ctx.stroke();
      }

      this.ctx.restore();
    }
  }

  private drawBlobShadow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, alpha = 0.30) {
  const r = Math.max(2, radius);
  const rx = r * 0.90;      // ~0.8 of sprite width (approx)
  const ry = r * 0.35;      // ~0.35 of sprite height (approx)
  const oy = r * 0.90;      // push shadow to "foot" area

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(0,0,0,1)';

  // soft-ish blob in 2 passes (cheap)
  ctx.globalAlpha = alpha * 0.55;
  ctx.beginPath();
  ctx.ellipse(x, y + oy, rx * 1.15, ry * 1.15, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.ellipse(x, y + oy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

}