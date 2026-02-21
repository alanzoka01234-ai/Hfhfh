export class Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  decay: number;
  drag: number;

  constructor(x: number, y: number, color: string, speedScale = 1) {
    this.x = x;
    this.y = y;

    const angle = Math.random() * Math.PI * 2;
    const speed = (Math.random() * 2.6 + 0.8) * speedScale;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;

    this.maxLife = 1;
    this.life = 1;
    this.decay = Math.random() * 0.04 + 0.02; // per-frame-ish; scaled by timeMult
    this.drag = Math.random() * 0.04 + 0.02;

    this.color = color;
    this.size = Math.random() * 2.6 + 1.2;
  }

  update(timeMult: number) {
    // timeMult ~ 1 at 60fps, scaled by timescale
    const tm = Math.max(0.25, Math.min(3, timeMult));

    this.x += this.vx * tm;
    this.y += this.vy * tm;

    // soft drag
    const drag = Math.pow(1 - this.drag, tm);
    this.vx *= drag;
    this.vy *= drag;

    this.life -= this.decay * tm;
  }

  draw(ctx: CanvasRenderingContext2D, outerGlow = true) {
    const a = Math.max(0, this.life / this.maxLife);
    if (a <= 0) return;

    ctx.globalAlpha = a;
    ctx.fillStyle = this.color;

    // soft glow core
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();

    if (outerGlow) {
      // outer glow (cheap)
      ctx.globalAlpha = a * 0.45;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }
}

export class ParticleSystem {
  particles: Particle[] = [];
  maxParticles = 900;
  fxQuality: 'low' | 'medium' | 'high' = 'medium';

  emit(x: number, y: number, color: string, count: number, speedScale = 1) {
    for (let i = 0; i < count; i++) {
      this.particles.push(new Particle(x, y, color, speedScale));
    }
    // cap
    if (this.particles.length > this.maxParticles) {
      this.particles.splice(0, this.particles.length - this.maxParticles);
    }
  }

  update(timeMult: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.update(timeMult);
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    if (this.particles.length === 0) return;

    // blob shadow (cheap) - evita peso: só quando tem pouca partícula
    if (this.particles.length <= 220) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(0,0,0,1)';
      for (const p of this.particles) {
        const a = Math.max(0, p.life / p.maxLife);
        if (a <= 0) continue;
        const alpha = Math.min(0.14, 0.10 * a);
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + p.size * 1.1, Math.max(1, p.size * 0.85), Math.max(1, p.size * 0.35), 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.save();

    const outerGlow = this.fxQuality !== 'low';

    // small shadow glow boost (disable on LOW for performance)
    ctx.shadowBlur = outerGlow ? 10 : 0;
    ctx.shadowColor = outerGlow ? 'rgba(255,255,255,0.15)' : 'transparent';

    for (const p of this.particles) {
      p.draw(ctx, outerGlow);
    }

    ctx.restore();
    ctx.globalCompositeOperation = prev;
  }
}
