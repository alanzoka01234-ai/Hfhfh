import { COLORS } from '../config/constants';



export class Entity {
  x: number;
  y: number;

  // World coordinates (alias). Use worldX/worldY for game logic; x/y remain for compatibility.
  get worldX() { return this.x; }
  set worldX(v: number) { this.x = v; }
  get worldY() { return this.y; }
  set worldY(v: number) { this.y = v; }
  radius: number;
  color: string;

  constructor(x: number, y: number, radius: number, color: string) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.color = color;
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.shadowBlur = 10;
    ctx.shadowColor = this.color;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, Math.max(0, this.radius), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export class Player extends Entity {
  constructor(x: number, y: number, color?: string) {
    super(x, y, 14, color || COLORS.PLAYER);
  }

  // Player sprite (URL provided by user)
  private static sprite: HTMLImageElement | null = null;

  private static getSprite(): HTMLImageElement | null {
    if (Player.sprite) return Player.sprite;
    if (typeof Image === 'undefined') return null;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = 'https://i.postimg.cc/XJq3h678/file-0000000046b871f5bc83ba85e7d18e2a.png';
    Player.sprite = img;
    return img;
  }


  draw(ctx: CanvasRenderingContext2D) {

    const sprite = Player.getSprite();
    if (sprite && sprite.complete && sprite.naturalWidth > 0) {
      const size = this.radius * 3;
      ctx.save();
      // Keep the sprite crisp and avoid a huge halo
      ctx.imageSmoothingEnabled = false;
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      ctx.globalAlpha = 1;
      ctx.drawImage(sprite, this.x - size / 2, this.y - size / 2, size, size);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2.5;
    
    ctx.beginPath();
    ctx.moveTo(this.x, this.y - this.radius);
    ctx.lineTo(this.x + this.radius, this.y + this.radius);
    ctx.lineTo(this.x, this.y + this.radius * 0.4);
    ctx.lineTo(this.x - this.radius, this.y + this.radius);
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = this.color;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(this.x, this.y + this.radius * 0.7, Math.max(0, 5), 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
  }
}

export class Enemy extends Entity {
  hp: number;
  maxHp: number;
  speed: number;
  isBoss: boolean;
  shieldMs: number = 0;
  spawnMs: number = 260;
  hitFlashMs: number = 0;
  actFlashMs: number = 0;
  animMs: number = 0;

  // States
  freezeMs: number = 0;
  fearMs: number = 0;
  slowMs: number = 0;
  slowIntensity: number = 0;
  burnMs: number = 0;
  burnTimer: number = 0;
  burnDmgPerTick: number = 0;

  constructor(x: number, y: number, hp: number, speed: number, isBoss = false) {
    super(x, y, isBoss ? 40 : 10, isBoss ? COLORS.BOSS : COLORS.ENEMY);
    this.hp = hp;
    this.maxHp = hp;
    this.speed = speed;
    this.isBoss = isBoss;
  }

  update(playerX: number, playerY: number, timeMult: number) {
    const dtMs = 16.66 * timeMult;
    this.animMs += dtMs;
    
    if (this.freezeMs > 0) {
      this.freezeMs = Math.max(0, this.freezeMs - dtMs);
      return; // Stop moving while frozen
    }
    
    // Process Burn
    if (this.burnMs > 0) {
      this.burnMs = Math.max(0, this.burnMs - dtMs);
      this.burnTimer += dtMs;
      if (this.burnTimer >= 200) {
        this.hp -= this.burnDmgPerTick;
        this.hitFlashMs = Math.max(this.hitFlashMs, 50);
        this.burnTimer = 0;
      }
    }

    if (this.fearMs > 0) this.fearMs = Math.max(0, this.fearMs - dtMs);
    if (this.slowMs > 0) this.slowMs = Math.max(0, this.slowMs - dtMs);
    if (this.spawnMs > 0) this.spawnMs = Math.max(0, this.spawnMs - dtMs);
    if (this.hitFlashMs > 0) this.hitFlashMs = Math.max(0, this.hitFlashMs - dtMs);
    if (this.actFlashMs > 0) this.actFlashMs = Math.max(0, this.actFlashMs - dtMs);
    if (this.shieldMs > 0) this.shieldMs = Math.max(0, this.shieldMs - dtMs);

    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist > 0) {
      const direction = this.fearMs > 0 ? -1 : 1;
      let currentSpeed = this.speed;
      if (this.slowMs > 0) currentSpeed *= (1 - this.slowIntensity);
      
      this.x += (dx / dist) * currentSpeed * timeMult * direction;
      this.y += (dy / dist) * currentSpeed * timeMult * direction;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const spawnT = this.spawnMs > 0 ? (1 - this.spawnMs / 260) : 1;
    const scale = 1 + (1 - spawnT) * 0.6;
    const alpha = 0.45 + spawnT * 0.55;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(scale, scale);
    ctx.translate(-this.x, -this.y);
    ctx.globalAlpha *= alpha;

    // No glow for enemies (player glow handled in Player.draw)
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = this.color;
    if (this.freezeMs > 0) {
      ctx.fillStyle = '#6ef7ff';
    } else if (this.burnMs > 0) {
      ctx.fillStyle = '#ff7a00';
    } else if (this.slowMs > 0) {
      ctx.fillStyle = '#6ef7ff';
    } else if (this.fearMs > 0) {
      ctx.fillStyle = '#ff00ff';
    } else if (this.hitFlashMs > 0) {
      ctx.fillStyle = '#ffffff';
    }

    ctx.beginPath();
    ctx.arc(this.x, this.y, Math.max(0, this.radius), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (this.actFlashMs > 0) {
      const t = 1 - this.actFlashMs / 120;
      ctx.save();
      ctx.strokeStyle = `rgba(255,255,255,${0.18 * (1 - t)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, Math.max(0, this.radius + 10 + t * 18), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (this.shieldMs > 0 && !this.isBoss) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.32)';
      ctx.lineWidth = 2;
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      ctx.beginPath();
      ctx.arc(this.x, this.y, Math.max(0, this.radius + 6), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (!this.isBoss) {
      const barWidth = this.radius * 2;
      const healthPercent = this.maxHp > 0 ? (this.hp / this.maxHp) : 0;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(this.x - this.radius, this.y - this.radius - 10, barWidth, 4);
      ctx.fillStyle = this.color;
      ctx.fillRect(this.x - this.radius, this.y - this.radius - 10, barWidth * clamp(healthPercent, 0, 1), 4);
    }
  }
}

type SmartCtx = {
  dtMs: number;
  timeMult: number;
  playerVx: number;
  playerVy: number;
  width: number;
  height: number;
  enemies: Enemy[];
  spawnEnemyBullet: (x: number, y: number, tx: number, ty: number, damage: number, speed?: number) => void;
  spawnMinion: (x: number, y: number, hp: number, speed: number) => void;
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function len(x: number, y: number) {
  return Math.sqrt(x * x + y * y);
}

function norm(dx: number, dy: number) {
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: dx / d, y: dy / d, d };
}

export class EnemyBullet extends Entity {
  vx: number;
  vy: number;
  damage: number;
  justSpawned: boolean = true;



  constructor(
    x: number,
    y: number,
    tx: number,
    ty: number,
    damage: number,
    color: string = 'rgba(255, 160, 0, 0.95)',
    speed: number = 9.5
  ) {
    super(x, y, 3.5, color);
    const n = norm(tx - x, ty - y);
    this.vx = n.x * speed;
    this.vy = n.y * speed;
    this.damage = damage;
  }

  update(timeMult: number) {
    if (this.justSpawned) { this.justSpawned = false; return; }
    this.x += this.vx * timeMult;
    this.y += this.vy * timeMult;
  }

  draw(ctx: CanvasRenderingContext2D) {
    super.draw(ctx);
  }

}

export class DroneSwarmEnemy extends Enemy {
  // Contact damage: 1 dmg per ~170ms => ~6 DPS while touching
  contactTickMs = 170;
  contactDamage = 1;
  contactAccMs = 0;

  // Low knockback
  kbMult = 0.35;

  // XP drop: small but frequent
  xpDropChance = 0.9;
  xpDropValue = 4;

  // Death VFX: mini explosion (visual only)
  deathVfx = 'mini';
  deathVfxCount = 14;
  deathVfxColor = 'rgba(255, 255, 255, 0.85)';

  private phase = Math.random() * Math.PI * 2;
  private ageMs = 0;

  constructor(x: number, y: number, hp: number, speed: number) {
    super(x, y, hp, speed);
    this.color = '#7CFF00';
    this.radius = 9;
  }

  updateSmart(playerX: number, playerY: number, ctx: SmartCtx) {
    if (this.freezeMs > 0) {
      this.freezeMs = Math.max(0, this.freezeMs - ctx.dtMs);
      return;
    }

    const dtMs = ctx.dtMs;
    this.ageMs += dtMs;
    if (this.burnMs > 0) {
      this.burnMs = Math.max(0, this.burnMs - dtMs);
      this.burnTimer += dtMs;
      if (this.burnTimer >= 200) { this.hp -= this.burnDmgPerTick; this.hitFlashMs = Math.max(this.hitFlashMs, 50); this.burnTimer = 0; }
    }
    if (this.slowMs > 0) this.slowMs = Math.max(0, this.slowMs - dtMs);
    if (this.shieldMs > 0) this.shieldMs = Math.max(0, this.shieldMs - dtMs);
    if (this.spawnMs > 0) this.spawnMs = Math.max(0, this.spawnMs - dtMs);
    if (this.hitFlashMs > 0) this.hitFlashMs = Math.max(0, this.hitFlashMs - dtMs);
    if (this.actFlashMs > 0) this.actFlashMs = Math.max(0, this.actFlashMs - dtMs);
    if (this.fearMs > 0) this.fearMs = Math.max(0, this.fearMs - dtMs);

    this.animMs += dtMs;

    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const d = len(dx, dy) || 1;
    const nx = dx / d;
    const ny = dy / d;

    let s = this.speed;
    if (this.slowMs > 0) s *= (1 - this.slowIntensity);

    // Fear makes it flee
    if (this.fearMs > 0) {
      this.x -= nx * s * ctx.timeMult;
      this.y -= ny * s * ctx.timeMult;
      return;
    }

    // "Curvinha" / swarm feel: add a changing perpendicular component so groups try to wrap around you
    const px = -ny;
    const py = nx;

    // Stronger curve when close, weaker when far (so it still pressures)
    const closeT = 1 - clamp(d / 260, 0, 1);
    const swirl = Math.sin((this.animMs * 0.004) + this.phase);
    const curve = (0.35 + 0.35 * closeT) * swirl;

    // Slight bias so different drones don't mirror perfectly
    const bias = Math.sin(this.phase * 3.0) * 0.12;

    const vx = nx + px * (curve + bias);
    const vy = ny + py * (curve + bias);
    const vd = len(vx, vy) || 1;

    this.x += (vx / vd) * s * 1.0 * ctx.timeMult;
    this.y += (vy / vd) * s * 1.0 * ctx.timeMult;
}
}
export class BurstHunterEnemy extends Enemy {
  // XP drop: medium chance/value
  xpDropChance = 0.65;
  xpDropValue = 12;

  private shootCdMs = 900 + Math.random() * 900;
  private telegraphMs = 0;
  private pendingBurst = false;

  private strafeDir = 1;
  private strafeMs = 0;
  private aimDx = 1;
  private aimDy = 0;

  private ageMs = 0;

  constructor(x: number, y: number, hp: number, speed: number) {
    super(x, y, hp, speed);
    this.color = '#FF4D7D';
    this.radius = 11;
  }

  updateSmart(playerX: number, playerY: number, ctx: SmartCtx) {
    const dtMs = ctx.dtMs;
    this.ageMs += dtMs;

    // Basic status ticking (same pattern as other smart enemies)
    if (this.freezeMs > 0) { this.freezeMs = Math.max(0, this.freezeMs - dtMs); return; }
    if (this.burnMs > 0) {
      this.burnMs = Math.max(0, this.burnMs - dtMs);
      this.burnTimer += dtMs;
      if (this.burnTimer >= 200) { this.hp -= this.burnDmgPerTick; this.hitFlashMs = Math.max(this.hitFlashMs, 50); this.burnTimer = 0; }
    }
    if (this.fearMs > 0) this.fearMs = Math.max(0, this.fearMs - dtMs);
    if (this.slowMs > 0) this.slowMs = Math.max(0, this.slowMs - dtMs);
    if (this.shieldMs > 0) this.shieldMs = Math.max(0, this.shieldMs - dtMs);
    if (this.spawnMs > 0) this.spawnMs = Math.max(0, this.spawnMs - dtMs);
    if (this.hitFlashMs > 0) this.hitFlashMs = Math.max(0, this.hitFlashMs - dtMs);
    if (this.actFlashMs > 0) this.actFlashMs = Math.max(0, this.actFlashMs - dtMs);

    this.animMs += dtMs;

    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const d = len(dx, dy) || 1;
    const nx = dx / d;
    const ny = dy / d;

    let s = this.speed;
    if (this.slowMs > 0) s *= (1 - this.slowIntensity);

    // Fear makes it flee
    if (this.fearMs > 0) {
      this.x -= nx * s * ctx.timeMult;
      this.y -= ny * s * ctx.timeMult;
      return;
    }

    // Telegraph / aim freeze
    if (this.telegraphMs > 0) {
      this.telegraphMs = Math.max(0, this.telegraphMs - dtMs);
      this.aimDx = nx;
      this.aimDy = ny;

      // Fire when the telegraph ends
      if (this.telegraphMs <= 0 && this.pendingBurst) {
        const baseAng = Math.atan2(this.aimDy, this.aimDx);
        const spread = 0.18; // cone
        const dmg = 8;

        // 3 shots in a fan (leque)
        for (const off of [-spread, 0, spread]) {
          const ang = baseAng + off;
          const tx = this.x + Math.cos(ang) * 1000;
          const ty = this.y + Math.sin(ang) * 1000;
          ctx.spawnEnemyBullet(this.x, this.y, tx, ty, dmg, 12.0); // high projectile speed
        }

        this.pendingBurst = false;
        this.shootCdMs = 2200;
        this.actFlashMs = Math.max(this.actFlashMs, 140);
      }
      return;
    }

    // Movement: keep medium distance, strafe a bit (forces dodging)
    this.shootCdMs = Math.max(0, this.shootCdMs - dtMs);

    this.strafeMs = Math.max(0, this.strafeMs - dtMs);
    if (this.strafeMs <= 0) {
      this.strafeDir = Math.random() < 0.5 ? -1 : 1;
      this.strafeMs = 700 + Math.random() * 900;
    }

    const minD = 110;
    const maxD = 170;

    if (d < minD) {
      this.x -= nx * s * 1.05 * ctx.timeMult;
      this.y -= ny * s * 1.05 * ctx.timeMult;
    } else if (d > maxD) {
      this.x += nx * s * 0.75 * ctx.timeMult;
      this.y += ny * s * 0.75 * ctx.timeMult;
    } else {
      const px = -ny * this.strafeDir;
      const py = nx * this.strafeDir;
      this.x += px * s * 0.40 * ctx.timeMult;
      this.y += py * s * 0.40 * ctx.timeMult;
    }
// Start telegraph if ready (somente se estiver visível na tela)
    const camX = playerX - ctx.width / 2;
    const camY = playerY - ctx.height / 2;
    const sx = this.x - camX;
    const sy = this.y - camY;
    const onScreen = sx > -80 && sx < ctx.width + 80 && sy > -80 && sy < ctx.height + 80;

    // Só atira bem perto do player + grace após spawn
    const shootRange = 150; // px
    const spawnGraceMs = 800;

    if (this.shootCdMs <= 0 && onScreen && d <= shootRange && this.ageMs >= spawnGraceMs) {
      this.telegraphMs = 300; // 0.3s aim
      this.pendingBurst = true;
      this.actFlashMs = Math.max(this.actFlashMs, 300); // visual cue (blink/open wings)
      this.aimDx = nx;
      this.aimDy = ny;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    // Base body
    super.draw(ctx);

    // "Wings" / telegraph hint
    if (this.telegraphMs > 0 || this.actFlashMs > 240) {
      const a = Math.atan2(this.aimDy, this.aimDx);
      const wing = 12;
      const back = 6;

      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(a);
      ctx.globalAlpha *= 0.9;

      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.moveTo(-back, -wing);
      ctx.lineTo(wing, 0);
      ctx.lineTo(-back, wing);
      ctx.stroke();

      ctx.restore();
    }
  }
}



export class HunterEnemy extends Enemy {
  private dashCdMs = 0;
  dashMs = 0;
  private dashDirX = 0;
  private dashDirY = 0;
  private telegraphMs = 0;

  constructor(x: number, y: number, hp: number, speed: number) {
    super(x, y, hp, speed);
    this.color = '#ff3355';
    this.radius = 12;
  }

  // Hunter sprite (red enemy) (URL provided by user)
  private static sprite: HTMLImageElement | null = null;

  private static getSprite(): HTMLImageElement | null {
    if (HunterEnemy.sprite) return HunterEnemy.sprite;
    if (typeof Image === 'undefined') return null;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = 'https://i.postimg.cc/xd4HBYyZ/file-000000003618720e8ffcd1ddc1c24c19.png';
    HunterEnemy.sprite = img;
    return img;
  }


  updateSmart(playerX: number, playerY: number, ctx: SmartCtx) {
    if (this.freezeMs > 0) {
      this.freezeMs = Math.max(0, this.freezeMs - ctx.dtMs);
      return;
    }
    
    // Process Burn and Slow in updateSmart too
    const dtMs = ctx.dtMs;
    if (this.burnMs > 0) {
      this.burnMs = Math.max(0, this.burnMs - dtMs);
      this.burnTimer += dtMs;
      if (this.burnTimer >= 200) { this.hp -= this.burnDmgPerTick; this.hitFlashMs = Math.max(this.hitFlashMs, 50); this.burnTimer = 0; }
    }
    if (this.slowMs > 0) this.slowMs = Math.max(0, this.slowMs - dtMs);

    if (this.shieldMs > 0) this.shieldMs = Math.max(0, this.shieldMs - ctx.dtMs);
    if (this.spawnMs > 0) this.spawnMs = Math.max(0, this.spawnMs - ctx.dtMs);
    if (this.hitFlashMs > 0) this.hitFlashMs = Math.max(0, this.hitFlashMs - ctx.dtMs);
    if (this.actFlashMs > 0) this.actFlashMs = Math.max(0, this.actFlashMs - ctx.dtMs);
    if (this.fearMs > 0) this.fearMs = Math.max(0, this.fearMs - ctx.dtMs);
    this.animMs += ctx.dtMs;

    this.dashCdMs = Math.max(0, this.dashCdMs - ctx.dtMs);
    this.telegraphMs = Math.max(0, this.telegraphMs - ctx.dtMs);
    this.dashMs = Math.max(0, this.dashMs - ctx.dtMs);

    const lead = clamp(0.18 + (Math.random() * 0.06), 0.12, 0.28);
    const tx = playerX + ctx.playerVx * lead;
    const ty = playerY + ctx.playerVy * lead;

    const to = norm(tx - this.x, ty - this.y);

    if (this.fearMs > 0) {
      let s = this.speed; if (this.slowMs > 0) s *= (1 - this.slowIntensity);
      this.x -= to.x * s * ctx.timeMult;
      this.y -= to.y * s * ctx.timeMult;
      return;
    }

    if (this.dashCdMs <= 0 && this.dashMs <= 0 && this.telegraphMs <= 0 && to.d < 220) {
      this.telegraphMs = 380;
      this.actFlashMs = Math.max(this.actFlashMs, 120);
      this.dashDirX = to.x;
      this.dashDirY = to.y;
    }

    if (this.telegraphMs <= 0 && this.dashCdMs <= 0 && this.dashMs <= 0 && to.d < 240) {
      this.dashMs = 220;
      this.actFlashMs = Math.max(this.actFlashMs, 120);
      this.dashCdMs = 3200 + Math.random() * 900;
    }

    if (this.dashMs > 0) {
      const dashTotal = 220;
      const t = 1 - this.dashMs / dashTotal;
      const ease = 0.5 - 0.5 * Math.cos(Math.PI * t);
      let dashSpeed = this.speed * (3.2 + 2.0 * ease);
      if (this.slowMs > 0) dashSpeed *= (1 - this.slowIntensity);
      this.x += this.dashDirX * dashSpeed * ctx.timeMult;
      this.y += this.dashDirY * dashSpeed * ctx.timeMult;
    } else {
      const slow = this.dashCdMs > 2800 ? 0.75 : 1.0;
      let s = this.speed * slow;
      if (this.slowMs > 0) s *= (1 - this.slowIntensity);
      this.x += to.x * s * ctx.timeMult;
      this.y += to.y * s * ctx.timeMult;
    }
  }

  draw(ctx2: CanvasRenderingContext2D) {
    const sprite = HunterEnemy.getSprite();
    if (sprite && sprite.complete && sprite.naturalWidth > 0) {
      const spawnT = this.spawnMs > 0 ? (1 - this.spawnMs / 260) : 1;
      const scale = 1 + (1 - spawnT) * 0.6;
      const alpha = 0.45 + spawnT * 0.55;

      ctx2.save();
      ctx2.translate(this.x, this.y);
      ctx2.scale(scale, scale);
      ctx2.translate(-this.x, -this.y);
      ctx2.globalAlpha *= alpha;

      ctx2.save();
      ctx2.imageSmoothingEnabled = false;
      ctx2.shadowBlur = 0;
      ctx2.shadowColor = 'transparent';

      const size = this.radius * 3;
      ctx2.drawImage(sprite, this.x - size / 2, this.y - size / 2, size, size);
      ctx2.restore();
      ctx2.restore();

      if (this.actFlashMs > 0) {
        const t = 1 - this.actFlashMs / 120;
        ctx2.save();
        ctx2.strokeStyle = `rgba(255,255,255,${0.18 * (1 - t)})`;
        ctx2.lineWidth = 2;
        ctx2.beginPath();
        ctx2.arc(this.x, this.y, Math.max(0, this.radius + 10 + t * 18), 0, Math.PI * 2);
        ctx2.stroke();
        ctx2.restore();
      }

      if (this.shieldMs > 0 && !this.isBoss) {
        ctx2.save();
        ctx2.strokeStyle = 'rgba(0, 255, 255, 0.32)';
        ctx2.lineWidth = 2;
        ctx2.shadowBlur = 0;
        ctx2.shadowColor = 'transparent';
        ctx2.beginPath();
        ctx2.arc(this.x, this.y, Math.max(0, this.radius + 6), 0, Math.PI * 2);
        ctx2.stroke();
        ctx2.restore();
      }

      if (this.telegraphMs > 0) {
        ctx2.save();
        ctx2.strokeStyle = 'rgba(255, 80, 120, 0.35)';
        ctx2.lineWidth = 2;
        ctx2.setLineDash([6, 6]);
        ctx2.beginPath();
        ctx2.moveTo(this.x, this.y);
        ctx2.lineTo(this.x + this.dashDirX * 120, this.y + this.dashDirY * 120);
        ctx2.stroke();
        ctx2.restore();
      }
      return;
    }

    super.draw(ctx2);
    if (this.telegraphMs > 0) {
      ctx2.save();
      ctx2.strokeStyle = 'rgba(255, 80, 120, 0.35)';
      ctx2.lineWidth = 2;
      ctx2.setLineDash([6, 6]);
      ctx2.beginPath();
      ctx2.moveTo(this.x, this.y);
      ctx2.lineTo(this.x + this.dashDirX * 120, this.y + this.dashDirY * 120);
      ctx2.stroke();
      ctx2.restore();
    }
  }
}

export class FlankerEnemy extends Enemy {
  private flankMs = 0;
  private flankSide = 1;
  private flankTargetX = 0;
  private flankTargetY = 0;

  constructor(x: number, y: number, hp: number, speed: number) {
    super(x, y, hp, speed);
    this.color = '#b300ff';
    this.radius = 11;
  }

  updateSmart(playerX: number, playerY: number, ctx: SmartCtx) {
    if (this.freezeMs > 0) {
      this.freezeMs = Math.max(0, this.freezeMs - ctx.dtMs);
      return;
    }
    const dtMs = ctx.dtMs;
    if (this.burnMs > 0) {
      this.burnMs = Math.max(0, this.burnMs - dtMs);
      this.burnTimer += dtMs;
      if (this.burnTimer >= 200) { this.hp -= this.burnDmgPerTick; this.hitFlashMs = Math.max(this.hitFlashMs, 50); this.burnTimer = 0; }
    }
    if (this.slowMs > 0) this.slowMs = Math.max(0, this.slowMs - dtMs);

    if (this.shieldMs > 0) this.shieldMs = Math.max(0, this.shieldMs - ctx.dtMs);
    if (this.spawnMs > 0) this.spawnMs = Math.max(0, this.spawnMs - ctx.dtMs);
    if (this.hitFlashMs > 0) this.hitFlashMs = Math.max(0, this.hitFlashMs - ctx.dtMs);
    if (this.actFlashMs > 0) this.actFlashMs = Math.max(0, this.actFlashMs - ctx.dtMs);
    if (this.fearMs > 0) this.fearMs = Math.max(0, this.fearMs - ctx.dtMs);
    this.animMs += ctx.dtMs;
    this.flankMs = Math.max(0, this.flankMs - ctx.dtMs);

    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const d = len(dx, dy) || 1;

    let s = this.speed;
    if (this.slowMs > 0) s *= (1 - this.slowIntensity);

    if (this.fearMs > 0) {
      this.x -= (dx/d) * s * ctx.timeMult;
      this.y -= (dy/d) * s * ctx.timeMult;
      return;
    }

    if (this.flankMs <= 0 && d < 320) {
      this.flankMs = 1400 + Math.random() * 700;
      this.actFlashMs = Math.max(this.actFlashMs, 120);
      this.flankSide = Math.random() < 0.5 ? -1 : 1;
      const nx = dx / d;
      const ny = dy / d;
      const px = -ny * this.flankSide;
      const py = nx * this.flankSide;
      const offset = 110 + Math.random() * 70;
      this.flankTargetX = playerX + px * offset;
      this.flankTargetY = playerY + py * offset;
    }

    if (this.flankMs > 0) {
      const to = norm(this.flankTargetX - this.x, this.flankTargetY - this.y);
      this.x += to.x * s * 1.15 * ctx.timeMult;
      this.y += to.y * s * 1.15 * ctx.timeMult;
    } else {
      const toP = norm(playerX - this.x, playerY - this.y);
      this.x += toP.x * s * ctx.timeMult;
      this.y += toP.y * s * ctx.timeMult;
    }
  }
}

export class ShieldDroneEnemy extends Enemy {
  private shieldCdMs = 0;
  private telegraphMs = 0;

  constructor(x: number, y: number, hp: number, speed: number) {
    super(x, y, hp, speed);
    this.color = '#00aaff';
    this.radius = 10;
  }

  updateSmart(playerX: number, playerY: number, ctx: SmartCtx) {
    if (this.freezeMs > 0) {
      this.freezeMs = Math.max(0, this.freezeMs - ctx.dtMs);
      return;
    }
    const dtMs = ctx.dtMs;
    if (this.burnMs > 0) {
      this.burnMs = Math.max(0, this.burnMs - dtMs);
      this.burnTimer += dtMs;
      if (this.burnTimer >= 200) { this.hp -= this.burnDmgPerTick; this.hitFlashMs = Math.max(this.hitFlashMs, 50); this.burnTimer = 0; }
    }
    if (this.slowMs > 0) this.slowMs = Math.max(0, this.slowMs - dtMs);

    if (this.shieldMs > 0) this.shieldMs = Math.max(0, this.shieldMs - ctx.dtMs);
    if (this.spawnMs > 0) this.spawnMs = Math.max(0, this.spawnMs - ctx.dtMs);
    if (this.hitFlashMs > 0) this.hitFlashMs = Math.max(0, this.hitFlashMs - ctx.dtMs);
    if (this.actFlashMs > 0) this.actFlashMs = Math.max(0, this.actFlashMs - ctx.dtMs);
    if (this.fearMs > 0) this.fearMs = Math.max(0, this.fearMs - ctx.dtMs);
    this.animMs += ctx.dtMs;
    this.shieldCdMs = Math.max(0, this.shieldCdMs - ctx.dtMs);
    this.telegraphMs = Math.max(0, this.telegraphMs - ctx.dtMs);

    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const d = len(dx, dy) || 1;
    const nx = dx / d;
    const ny = dy / d;

    let s = this.speed;
    if (this.slowMs > 0) s *= (1 - this.slowIntensity);

    if (this.fearMs > 0) {
      this.x -= nx * s * ctx.timeMult;
      this.y -= ny * s * ctx.timeMult;
      return;
    }

    const desired = d < 260 ? -1 : 1;
    this.x += nx * s * desired * 0.9 * ctx.timeMult;
    this.y += ny * s * desired * 0.9 * ctx.timeMult;

    if (this.shieldCdMs <= 0 && this.telegraphMs <= 0) {
      this.telegraphMs = 420;
      this.actFlashMs = Math.max(this.actFlashMs, 120);
      this.shieldCdMs = 8000 + Math.random() * 2500;
    }
    if (this.telegraphMs <= 0.0001 && this.shieldCdMs > 7600) {
      const r = 220;
      for (const e of ctx.enemies) {
        if (e === this || e.isBoss) continue;
        const ddx = e.x - this.x;
        const ddy = e.y - this.y;
        if (ddx * ddx + ddy * ddy <= r * r) {
          e.shieldMs = Math.max(e.shieldMs, 4500);
        }
      }
      this.shieldMs = Math.max(this.shieldMs, 2000);
      this.shieldCdMs = 7400 + Math.random() * 2500;
    }
}

  draw(ctx2: CanvasRenderingContext2D) {
    super.draw(ctx2);
    if (this.telegraphMs > 0) {
      ctx2.save();
      ctx2.strokeStyle = 'rgba(0, 170, 255, 0.25)';
      ctx2.lineWidth = 2;
      ctx2.beginPath();
      ctx2.arc(this.x, this.y, Math.max(0, 40 + (1 - this.telegraphMs / 420) * 40), 0, Math.PI * 2);
      ctx2.stroke();
      ctx2.restore();
    }
  }
}

export class SuppressorEnemy extends Enemy {
  private shootCdMs = 0;
  private telegraphMs = 0;
  private aimX = 0;
  private aimY = 0;
  private burstLeft = 0;
  private burstGapMs = 0;

  constructor(x: number, y: number, hp: number, speed: number) {
    super(x, y, hp, speed);
    this.color = '#ffd000';
    this.radius = 10;
  }

  updateSmart(playerX: number, playerY: number, ctx: SmartCtx) {
    if (this.freezeMs > 0) {
      this.freezeMs = Math.max(0, this.freezeMs - ctx.dtMs);
      return;
    }
    const dtMs = ctx.dtMs;
    if (this.burnMs > 0) {
      this.burnMs = Math.max(0, this.burnMs - dtMs);
      this.burnTimer += dtMs;
      if (this.burnTimer >= 200) { this.hp -= this.burnDmgPerTick; this.hitFlashMs = Math.max(this.hitFlashMs, 50); this.burnTimer = 0; }
    }
    if (this.slowMs > 0) this.slowMs = Math.max(0, this.slowMs - dtMs);

    if (this.shieldMs > 0) this.shieldMs = Math.max(0, this.shieldMs - ctx.dtMs);
    if (this.spawnMs > 0) this.spawnMs = Math.max(0, this.spawnMs - ctx.dtMs);
    if (this.hitFlashMs > 0) this.hitFlashMs = Math.max(0, this.hitFlashMs - ctx.dtMs);
    if (this.actFlashMs > 0) this.actFlashMs = Math.max(0, this.actFlashMs - ctx.dtMs);
    if (this.fearMs > 0) this.fearMs = Math.max(0, this.fearMs - ctx.dtMs);
    this.animMs += ctx.dtMs;
    this.shootCdMs = Math.max(0, this.shootCdMs - ctx.dtMs);
    this.telegraphMs = Math.max(0, this.telegraphMs - ctx.dtMs);
    this.burstGapMs = Math.max(0, this.burstGapMs - ctx.dtMs);

    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const d = len(dx, dy) || 1;
    const nx = dx / d;
    const ny = dy / d;

    let s = this.speed;
    if (this.slowMs > 0) s *= (1 - this.slowIntensity);

    if (this.fearMs > 0) {
      this.x -= nx * s * ctx.timeMult;
      this.y -= ny * s * ctx.timeMult;
      return;
    }

    const minD = 220;
    const maxD = 360;
    if (d < minD) {
      this.x -= nx * s * 1.1 * ctx.timeMult;
      this.y -= ny * s * 1.1 * ctx.timeMult;
    } else if (d > maxD) {
      this.x += nx * s * 0.85 * ctx.timeMult;
      this.y += ny * s * 0.85 * ctx.timeMult;
    } else {
      const px = -ny;
      const py = nx;
      this.x += px * s * 0.35 * ctx.timeMult;
      this.y += py * s * 0.35 * ctx.timeMult;
    }

    if (this.shootCdMs <= 0 && this.telegraphMs <= 0 && this.burstLeft <= 0) {
      this.telegraphMs = 380;
      this.actFlashMs = Math.max(this.actFlashMs, 120);
      const lead = clamp(d / 850, 0.10, 0.30);
      this.aimX = playerX + ctx.playerVx * lead;
      this.aimY = playerY + ctx.playerVy * lead;
      this.burstLeft = 2 + (Math.random() < 0.35 ? 1 : 0);
      this.burstGapMs = 0;
    }

    if (this.telegraphMs <= 0 && this.burstLeft > 0 && this.burstGapMs <= 0) {
      const jitter = 10 + Math.random() * 12;
      ctx.spawnEnemyBullet(this.x, this.y, this.aimX + (Math.random() - 0.5) * jitter, this.aimY + (Math.random() - 0.5) * jitter, 6);
      this.burstLeft--;
      this.burstGapMs = 140;
      if (this.burstLeft <= 0) {
        this.shootCdMs = 1250 + Math.random() * 700;
      }
    }
}

  draw(ctx2: CanvasRenderingContext2D) {
    super.draw(ctx2);
    if (this.telegraphMs > 0) {
      ctx2.save();
      ctx2.strokeStyle = 'rgba(255, 208, 0, 0.25)';
      ctx2.lineWidth = 2;
      ctx2.setLineDash([8, 8]);
      ctx2.beginPath();
      ctx2.moveTo(this.x, this.y);
      ctx2.lineTo(this.aimX, this.aimY);
      ctx2.stroke();
      ctx2.restore();
    }
  }
}

export class GunnerEnemy extends Enemy {
  private shootCdMs = 0;
  private telegraphMs = 0;
  private aimX = 0;
  private aimY = 0;
  private pendingShot = false;
  private strafeDir = 1;
  private strafeMs = 0;

  constructor(x: number, y: number, hp: number, speed: number) {
    super(x, y, hp, speed);
    this.color = '#ff4df0';
    this.radius = 10;
  }

  updateSmart(playerX: number, playerY: number, ctx: SmartCtx) {
    if (this.freezeMs > 0) {
      this.freezeMs = Math.max(0, this.freezeMs - ctx.dtMs);
      return;
    }
    const dtMs = ctx.dtMs;
    if (this.burnMs > 0) {
      this.burnMs = Math.max(0, this.burnMs - dtMs);
      this.burnTimer += dtMs;
      if (this.burnTimer >= 200) { this.hp -= this.burnDmgPerTick; this.hitFlashMs = Math.max(this.hitFlashMs, 50); this.burnTimer = 0; }
    }
    if (this.slowMs > 0) this.slowMs = Math.max(0, this.slowMs - dtMs);

    if (this.shieldMs > 0) this.shieldMs = Math.max(0, this.shieldMs - ctx.dtMs);
    if (this.spawnMs > 0) this.spawnMs = Math.max(0, this.spawnMs - ctx.dtMs);
    if (this.hitFlashMs > 0) this.hitFlashMs = Math.max(0, this.hitFlashMs - ctx.dtMs);
    if (this.actFlashMs > 0) this.actFlashMs = Math.max(0, this.actFlashMs - ctx.dtMs);
    if (this.fearMs > 0) this.fearMs = Math.max(0, this.fearMs - ctx.dtMs);
    this.animMs += ctx.dtMs;
    this.shootCdMs = Math.max(0, this.shootCdMs - ctx.dtMs);
    this.telegraphMs = Math.max(0, this.telegraphMs - ctx.dtMs);

const dx = playerX - this.x;
const dy = playerY - this.y;
const d = len(dx, dy) || 1;
const nx = dx / d;
const ny = dy / d;

let s = this.speed;
if (this.slowMs > 0) s *= (1 - this.slowIntensity);

if (this.fearMs > 0) {
  this.x -= nx * s * ctx.timeMult;
  this.y -= ny * s * ctx.timeMult;
  return;
}

// Keep a bit of distance and strafe instead of hugging the player
this.strafeMs = Math.max(0, this.strafeMs - ctx.dtMs);
if (this.strafeMs <= 0) {
  this.strafeDir = Math.random() < 0.5 ? -1 : 1;
  this.strafeMs = 900 + Math.random() * 900;
}

const minD = 200;
const maxD = 340;

// Slow movement slightly while aiming
const moveMult = this.telegraphMs > 0 ? 0.55 : 1.0;

if (d < minD) {
  this.x -= nx * s * 1.05 * moveMult * ctx.timeMult;
  this.y -= ny * s * 1.05 * moveMult * ctx.timeMult;
} else if (d > maxD) {
  this.x += nx * s * 0.80 * moveMult * ctx.timeMult;
  this.y += ny * s * 0.80 * moveMult * ctx.timeMult;
} else {
  // Strafe around the player
  const px = -ny * this.strafeDir;
  const py = nx * this.strafeDir;
  this.x += px * s * 0.45 * moveMult * ctx.timeMult;
  this.y += py * s * 0.45 * moveMult * ctx.timeMult;
}

if (this.shootCdMs <= 0 && this.telegraphMs <= 0) {
      this.telegraphMs = 280;
      this.actFlashMs = Math.max(this.actFlashMs, 120);
      const lead = clamp(d / 900, 0.08, 0.22);
      this.aimX = playerX + ctx.playerVx * lead;
      this.aimY = playerY + ctx.playerVy * lead;
      this.shootCdMs = 900 + Math.random() * 650;
      this.pendingShot = true;
    }
    if (this.telegraphMs <= 0.0001 && this.pendingShot) {
      ctx.spawnEnemyBullet(this.x, this.y, this.aimX, this.aimY, 5);
      this.pendingShot = false;
    }
}

  draw(ctx2: CanvasRenderingContext2D) {
    super.draw(ctx2);
    if (this.telegraphMs > 0) {
      ctx2.save();
      ctx2.strokeStyle = 'rgba(255, 77, 240, 0.22)';
      ctx2.lineWidth = 2;
      ctx2.setLineDash([6, 8]);
      ctx2.beginPath();
      ctx2.moveTo(this.x, this.y);
      ctx2.lineTo(this.aimX, this.aimY);
      ctx2.stroke();
      ctx2.restore();
    }
  }
}

export class SniperEnemy extends Enemy {
  private shootCdMs = 0;
  private telegraphMs = 0;
  private aimX = 0;
  private aimY = 0;
  private pendingShot = false;

  constructor(x: number, y: number, hp: number, speed: number) {
    super(x, y, hp, speed);
    this.color = '#6ef7ff';
    this.radius = 11;
  }

  updateSmart(playerX: number, playerY: number, ctx: SmartCtx) {
    if (this.freezeMs > 0) {
      this.freezeMs = Math.max(0, this.freezeMs - ctx.dtMs);
      return;
    }
    const dtMs = ctx.dtMs;
    if (this.burnMs > 0) {
      this.burnMs = Math.max(0, this.burnMs - dtMs);
      this.burnTimer += dtMs;
      if (this.burnTimer >= 200) { this.hp -= this.burnDmgPerTick; this.hitFlashMs = Math.max(this.hitFlashMs, 50); this.burnTimer = 0; }
    }
    if (this.slowMs > 0) this.slowMs = Math.max(0, this.slowMs - dtMs);

    if (this.shieldMs > 0) this.shieldMs = Math.max(0, this.shieldMs - ctx.dtMs);
    if (this.spawnMs > 0) this.spawnMs = Math.max(0, this.spawnMs - ctx.dtMs);
    if (this.hitFlashMs > 0) this.hitFlashMs = Math.max(0, this.hitFlashMs - ctx.dtMs);
    if (this.actFlashMs > 0) this.actFlashMs = Math.max(0, this.actFlashMs - ctx.dtMs);
    if (this.fearMs > 0) this.fearMs = Math.max(0, this.fearMs - ctx.dtMs);
    this.animMs += ctx.dtMs;
    this.shootCdMs = Math.max(0, this.shootCdMs - ctx.dtMs);
    this.telegraphMs = Math.max(0, this.telegraphMs - ctx.dtMs);

    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const d = len(dx, dy) || 1;
    const nx = dx / d;
    const ny = dy / d;

    let s = this.speed;
    if (this.slowMs > 0) s *= (1 - this.slowIntensity);

    if (this.fearMs > 0) {
      this.x -= nx * s * ctx.timeMult;
      this.y -= ny * s * ctx.timeMult;
      return;
    }

    if (d < 340) {
      this.x -= nx * s * 1.15 * ctx.timeMult;
      this.y -= ny * s * 1.15 * ctx.timeMult;
    } else if (d > 520) {
      this.x += nx * s * 0.55 * ctx.timeMult;
      this.y += ny * s * 0.55 * ctx.timeMult;
    }

    if (this.shootCdMs <= 0 && this.telegraphMs <= 0) {
      this.telegraphMs = 620;
      this.actFlashMs = Math.max(this.actFlashMs, 120);
      const lead = clamp(d / 720, 0.12, 0.45);
      this.aimX = playerX + ctx.playerVx * lead;
      this.aimY = playerY + ctx.playerVy * lead;
      this.shootCdMs = 2200 + Math.random() * 1200;
      this.pendingShot = true;
    }
    if (this.telegraphMs <= 0.0001 && this.pendingShot) {
      ctx.spawnEnemyBullet(this.x, this.y, this.aimX, this.aimY, 10);
      this.pendingShot = false;
    }
}

  draw(ctx2: CanvasRenderingContext2D) {
    super.draw(ctx2);
    if (this.telegraphMs > 0) {
      const t = 1 - this.telegraphMs / 620;
      ctx2.save();
      ctx2.strokeStyle = `rgba(110, 247, 255, ${0.10 + t * 0.25})`;
      ctx2.lineWidth = 2.5;
      ctx2.setLineDash([14, 10]);
      ctx2.beginPath();
      ctx2.moveTo(this.x, this.y);
      ctx2.lineTo(this.aimX, this.aimY);
      ctx2.stroke();
      ctx2.restore();
    }
  }
}

export class BomberEnemy extends Enemy {
  private armMs = 0;
  private cooldownMs = 0;

  constructor(x: number, y: number, hp: number, speed: number) {
    super(x, y, hp, speed);
    this.color = '#ff7a00';
    this.radius = 11;
  }

  updateSmart(playerX: number, playerY: number, ctx: SmartCtx) {
    if (this.freezeMs > 0) {
      this.freezeMs = Math.max(0, this.freezeMs - ctx.dtMs);
      return;
    }
    const dtMs = ctx.dtMs;
    if (this.burnMs > 0) {
      this.burnMs = Math.max(0, this.burnMs - dtMs);
      this.burnTimer += dtMs;
      if (this.burnTimer >= 200) { this.hp -= this.burnDmgPerTick; this.hitFlashMs = Math.max(this.hitFlashMs, 50); this.burnTimer = 0; }
    }
    if (this.slowMs > 0) this.slowMs = Math.max(0, this.slowMs - dtMs);

    if (this.shieldMs > 0) this.shieldMs = Math.max(0, this.shieldMs - ctx.dtMs);
    if (this.spawnMs > 0) this.spawnMs = Math.max(0, this.spawnMs - ctx.dtMs);
    if (this.hitFlashMs > 0) this.hitFlashMs = Math.max(0, this.hitFlashMs - ctx.dtMs);
    if (this.actFlashMs > 0) this.actFlashMs = Math.max(0, this.actFlashMs - ctx.dtMs);
    if (this.fearMs > 0) this.fearMs = Math.max(0, this.fearMs - ctx.dtMs);
    this.animMs += ctx.dtMs;
    this.cooldownMs = Math.max(0, this.cooldownMs - ctx.dtMs);
    this.armMs = Math.max(0, this.armMs - ctx.dtMs);

    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const d = len(dx, dy) || 1;
    const nx = dx / d;
    const ny = dy / d;

    let s = this.speed;
    if (this.slowMs > 0) s *= (1 - this.slowIntensity);

    if (this.fearMs > 0) {
      this.x -= nx * s * ctx.timeMult;
      this.y -= ny * s * ctx.timeMult;
      return;
    }

    if (this.armMs > 0) {
      this.x += nx * s * 0.1 * ctx.timeMult;
      this.y += ny * s * 0.1 * ctx.timeMult;
      return;
    }

    if (this.cooldownMs <= 0 && d < 120) {
      this.armMs = 780;
      this.actFlashMs = Math.max(this.actFlashMs, 120);
      this.cooldownMs = 2200;
      return;
    }

    this.x += nx * s * 1.05 * ctx.timeMult;
    this.y += ny * s * 1.05 * ctx.timeMult;
  }

  draw(ctx2: CanvasRenderingContext2D) {
    super.draw(ctx2);
    if (this.armMs > 0) {
      const t = 1 - this.armMs / 780;
      const r = 18 + t * 40;
      ctx2.save();
      ctx2.strokeStyle = `rgba(255, 120, 0, ${0.15 + t * 0.25})`;
      ctx2.lineWidth = 2;
      ctx2.beginPath();
      ctx2.arc(this.x, this.y, Math.max(0, r), 0, Math.PI * 2);
      ctx2.stroke();
      ctx2.restore();
    }
  }

  getArmingMs() { return this.armMs; }
  consumeExplosion() { this.hp = 0; }
}

export class SummonerEnemy extends Enemy {
  private castCdMs = 0;
  private portalMs = 0;
  private blinkCdMs = 0;

  constructor(x: number, y: number, hp: number, speed: number) {
    super(x, y, hp, speed);
    this.color = '#00ff66';
    this.radius = 12;
  }

  updateSmart(playerX: number, playerY: number, ctx: SmartCtx) {
    if (this.freezeMs > 0) {
      this.freezeMs = Math.max(0, this.freezeMs - ctx.dtMs);
      return;
    }
    const dtMs = ctx.dtMs;
    if (this.burnMs > 0) {
      this.burnMs = Math.max(0, this.burnMs - dtMs);
      this.burnTimer += dtMs;
      if (this.burnTimer >= 200) { this.hp -= this.burnDmgPerTick; this.hitFlashMs = Math.max(this.hitFlashMs, 50); this.burnTimer = 0; }
    }
    if (this.slowMs > 0) this.slowMs = Math.max(0, this.slowMs - dtMs);

    if (this.shieldMs > 0) this.shieldMs = Math.max(0, this.shieldMs - ctx.dtMs);
    if (this.spawnMs > 0) this.spawnMs = Math.max(0, this.spawnMs - ctx.dtMs);
    if (this.hitFlashMs > 0) this.hitFlashMs = Math.max(0, this.hitFlashMs - ctx.dtMs);
    if (this.actFlashMs > 0) this.actFlashMs = Math.max(0, this.actFlashMs - ctx.dtMs);
    if (this.fearMs > 0) this.fearMs = Math.max(0, this.fearMs - ctx.dtMs);
    this.animMs += ctx.dtMs;
    this.castCdMs = Math.max(0, this.castCdMs - ctx.dtMs);
    this.portalMs = Math.max(0, this.portalMs - ctx.dtMs);
    this.blinkCdMs = Math.max(0, this.blinkCdMs - ctx.dtMs);

    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const d = len(dx, dy) || 1;
    const nx = dx / d;
    const ny = dy / d;

    let s = this.speed;
    if (this.slowMs > 0) s *= (1 - this.slowIntensity);

    if (this.fearMs > 0) {
      this.x -= nx * s * ctx.timeMult;
      this.y -= ny * s * ctx.timeMult;
      return;
    }

    if (d < 260) {
      this.x -= nx * s * 1.1 * ctx.timeMult;
      this.y -= ny * s * 1.1 * ctx.timeMult;
      if (d < 160 && this.blinkCdMs <= 0) {
        this.actFlashMs = Math.max(this.actFlashMs, 120);
        this.blinkCdMs = 8500 + Math.random() * 3500;
      }
    } else if (d > 420) {
      this.x += nx * s * 0.55 * ctx.timeMult;
      this.y += ny * s * 0.55 * ctx.timeMult;
    }

    if (this.castCdMs <= 0 && this.portalMs <= 0) {
      this.portalMs = 650;
      this.actFlashMs = Math.max(this.actFlashMs, 120);
    }
    if (this.portalMs <= 0 && this.castCdMs <= 0) {
      const count = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 40 + Math.random() * 40;
        ctx.spawnMinion(this.x + Math.cos(a) * r, this.y + Math.sin(a) * r, 16, 1.25);
      }
      this.castCdMs = 9500 + Math.random() * 4500;
    }
  }

  draw(ctx2: CanvasRenderingContext2D) {
    super.draw(ctx2);
    if (this.portalMs > 0) {
      const t = 1 - this.portalMs / 650;
      ctx2.save();
      ctx2.strokeStyle = `rgba(0, 255, 102, ${0.15 + t * 0.25})`;
      ctx2.lineWidth = 2;
      ctx2.setLineDash([10, 6]);
      ctx2.beginPath();
      ctx2.arc(this.x, this.y, Math.max(0, 18 + t * 28), 0, Math.PI * 2);
      ctx2.stroke();
      ctx2.restore();
    }
  }
}

type BossState = 'ENTERING' | 'IDLE' | 'BURST' | 'SPIN_LASER' | 'RADIAL_LASER' | 'VULNERABLE';

export class Boss extends Enemy {
  bossState: BossState = 'ENTERING';
  stateTimer: number = 0;
  attackTimer: number = 0;
  laserAngle: number = 0;
  targetAngle: number = 0;

  constructor(x: number, y: number, hp: number) {
    super(x, y, hp, 0.5, true);
    this.radius = 60;
  }

  updateAI(playerX: number, playerY: number, dtMs: number, timeMult: number, shootCallback: (tx: number, ty: number) => void) {
    if (this.freezeMs > 0) {
      this.freezeMs = Math.max(0, this.freezeMs - dtMs);
      return;
    }
    
    // Process Burn and Slow for Boss
    if (this.burnMs > 0) {
      this.burnMs = Math.max(0, this.burnMs - dtMs);
      this.burnTimer += dtMs;
      if (this.burnTimer >= 200) { this.hp -= this.burnDmgPerTick; this.hitFlashMs = Math.max(this.hitFlashMs, 50); this.burnTimer = 0; }
    }
    if (this.slowMs > 0) this.slowMs = Math.max(0, this.slowMs - dtMs);

    this.stateTimer += dtMs;
    const isEnraged = this.hp < this.maxHp * 0.5;
    const speedMult = isEnraged ? 1.5 : 1.0;

    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    let s = this.speed * speedMult;
    if (this.slowMs > 0) s *= (1 - this.slowIntensity);

    if (dist > 200) {
      const dir = this.fearMs > 0 ? -1 : 1;
      this.x += (dx / dist) * s * timeMult * dir;
      this.y += (dy / dist) * s * timeMult * dir;
    }

    if (this.fearMs > 0) { this.fearMs = Math.max(0, this.fearMs - dtMs); return; }

    switch (this.bossState) {
      case 'ENTERING': if (this.stateTimer > 2000) { this.bossState = 'IDLE'; this.stateTimer = 0; } break;
      case 'IDLE':
        if (this.stateTimer > 2000 / speedMult) {
          const rand = Math.random();
          if (rand < 0.4) this.bossState = 'BURST';
          else if (rand < 0.7) this.bossState = 'SPIN_LASER';
          else this.bossState = 'RADIAL_LASER';
          this.stateTimer = 0; this.attackTimer = 0;
        }
        break;
      case 'BURST':
        this.attackTimer += dtMs;
        if (this.attackTimer > 200 / speedMult) { shootCallback(playerX, playerY); this.attackTimer = 0; }
        if (this.stateTimer > 2500) { this.bossState = 'IDLE'; this.stateTimer = 0; }
        break;
      case 'SPIN_LASER':
        this.laserAngle += 0.03 * speedMult * timeMult;
        if (this.stateTimer > 4000) { this.bossState = 'VULNERABLE'; this.stateTimer = 0; }
        break;
      case 'RADIAL_LASER': if (this.stateTimer > 3000) { this.bossState = 'VULNERABLE'; this.stateTimer = 0; } break;
      case 'VULNERABLE': if (this.stateTimer > 3000) { this.bossState = 'IDLE'; this.stateTimer = 0; } break;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const isVulnerable = this.bossState === 'VULNERABLE';
    const isEnraged = this.hp < this.maxHp * 0.5;
    ctx.save();
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    ctx.fillStyle = isVulnerable ? '#003333' : '#111';
    ctx.strokeStyle = isVulnerable ? '#00ffff' : (isEnraged ? '#ff0000' : this.color);
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      const px = this.x + Math.cos(angle) * this.radius;
      const py = this.y + Math.sin(angle) * this.radius;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    if (isVulnerable) { ctx.fillStyle = '#00ffff'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'; ctx.fillText('VULNERABLE', this.x, this.y + 5); }
    if (this.bossState === 'SPIN_LASER') this.drawLaser(ctx, this.laserAngle);
    else if (this.bossState === 'RADIAL_LASER') { const isActive = this.stateTimer > 1000; for (let i = 0; i < 8; i++) this.drawLaser(ctx, (Math.PI / 4) * i, !isActive); }
    ctx.restore();
  }

  private drawLaser(ctx: CanvasRenderingContext2D, angle: number, isTelegraph = false) {
    ctx.save();
    if (isTelegraph) { ctx.strokeStyle = 'rgba(255, 0, 0, 0.2)'; ctx.lineWidth = 2; ctx.setLineDash([10, 10]); }
    else { ctx.strokeStyle = 'rgba(255, 0, 85, 0.8)'; ctx.lineWidth = 15; ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; }
    ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(this.x + Math.cos(angle) * 2000, this.y + Math.sin(angle) * 2000); ctx.stroke();
    ctx.restore();
  }

  checkLaserHit(playerX: number, playerY: number): boolean {
    if (this.bossState === 'SPIN_LASER' && this.stateTimer > 500) return this.isPointNearLine(playerX, playerY, this.laserAngle);
    if (this.bossState === 'RADIAL_LASER' && this.stateTimer > 1000) { for (let i = 0; i < 8; i++) if (this.isPointNearLine(playerX, playerY, (Math.PI / 4) * i)) return true; }
    return false;
  }

  private isPointNearLine(px: number, py: number, angle: number): boolean {
    const dx = px - this.x; const dy = py - this.y;
    const lineDist = Math.abs(dx * Math.sin(angle) - dy * Math.cos(angle));
    const dotProduct = dx * Math.cos(angle) + dy * Math.sin(angle);
    return lineDist < 20 && dotProduct > 0;
  }
}

export class Bullet extends Entity {
  vx: number;
  vy: number;
  damage: number;
  pierce: number;
  kbMult: number;
  justSpawned: boolean = true;

  constructor(
    x: number,
    y: number,
    tx: number,
    ty: number,
    damage: number,
    color?: string,
    speed: number = 10,
    pierce: number = 0,
    kbMult: number = 1
  ) {
    super(x, y, 4, color || COLORS.BULLET);
    const dx = tx - x; const dy = ty - y; const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    this.vx = (dx / dist) * speed; this.vy = (dy / dist) * speed;
    this.damage = damage;
    this.pierce = pierce;
    this.kbMult = kbMult;
  }

  update(timeMult: number) {
    if (this.justSpawned) { this.justSpawned = false; return; }
    this.x += this.vx * timeMult;
    this.y += this.vy * timeMult;
  }
}

export class ExperienceCrystal extends Entity {
  value: number; vx: number = 0; vy: number = 0; age: number = 0; magnetDelay: number = 300; drag: number = 0.94; scale: number = 1.5; rotation: number = 0; omega: number = 0; isFake: boolean = false;
  constructor(x: number, y: number, value: number, vx: number = 0, vy: number = 0, isFake: boolean = false) {
    super(x, y, 4, COLORS.XP); this.value = value; this.vx = vx; this.vy = vy; this.isFake = isFake; this.omega = (Math.random() - 0.5) * 0.2; this.rotation = Math.random() * Math.PI * 2;
  }
  update(dtMs: number, timeMult: number) {
    this.age += dtMs;
    if (this.age < 200) this.scale = 1.5 - (this.age / 200) * 0.5; else this.scale = 1.0;
    this.x += this.vx * timeMult; this.y += this.vy * timeMult;
    this.vx *= Math.pow(this.drag, timeMult); this.vy *= Math.pow(this.drag, timeMult);
    this.rotation += this.omega * timeMult;
  }
  draw(ctx: CanvasRenderingContext2D) {
    ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.rotation); ctx.scale(this.scale, this.scale);
    ctx.shadowBlur = 10; ctx.shadowColor = this.color; ctx.fillStyle = this.color;
    ctx.beginPath(); ctx.moveTo(0, -this.radius); ctx.lineTo(this.radius, 0); ctx.lineTo(0, this.radius); ctx.lineTo(-this.radius, 0); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.5; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, Math.max(0, this.radius * 0.4), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

// Add missing Drone class referenced by GameEngine.ts
export class Drone extends Entity {
  private angle: number = 0;
  constructor(x: number, y: number) {
    super(x, y, 6, '#00ffcc');
  }

  update(playerX: number, playerY: number, timeMult: number) {
    this.angle += 0.05 * timeMult;
    const orbitRadius = 45;
    this.x = playerX + Math.cos(this.angle) * orbitRadius;
    this.y = playerY + Math.sin(this.angle) * orbitRadius;
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.shadowBlur = 15;
    ctx.shadowColor = this.color;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    // A small square drone
    ctx.rect(this.x - this.radius, this.y - this.radius, this.radius * 2, this.radius * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.x - this.radius, this.y - this.radius, this.radius * 2, this.radius * 2);
    ctx.restore();
  }
}

export type StructureType = 'bush' | 'rock' | 'crate';

let STRUCTURE_ID = 1;

export class Structure {
  id: number;
  x: number; // top-left (world)
  y: number; // top-left (world)
  w: number;
  h: number;

  hp: number;
  maxHp: number;

  solid = true;
  type: StructureType;

  // optional: avoids multiple hits in the same frame (we apply DPS, but keep it here for safety)
  hitCooldownMs = 0;

  constructor(x: number, y: number, w: number, h: number, type: StructureType, maxHp: number) {
    this.id = STRUCTURE_ID++;
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.type = type;
    this.maxHp = maxHp;
    this.hp = maxHp;
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
}

export class HealthPickup {
  x: number;
  y: number;
  radius: number;
  healPercent: number;
  ageMs = 0;
  lifeMs = 30000; // 30s

  constructor(x: number, y: number, healPercent: number, radius = 14) {
    this.x = x;
    this.y = y;
    this.healPercent = healPercent;
    this.radius = radius;
  }

  update(dtMs: number) {
    this.ageMs += dtMs;
  }

  get expired() { return this.ageMs >= this.lifeMs; }
}