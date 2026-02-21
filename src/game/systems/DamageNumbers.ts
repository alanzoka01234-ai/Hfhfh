export class DamageNumber {
  x: number;
  y: number;
  value: number;
  color: string;
  lifeMs: number;
  ageMs = 0;
  vx: number;
  vy: number;
  scale: number;
  isCrit: boolean;

  constructor(x: number, y: number, value: number, color = '#EAFBFF', isCrit = false) {
    this.x = x;
    this.y = y;
    this.value = Math.max(0, Math.round(value));
    this.color = color;

    // Slightly shorter + snappier
    this.lifeMs = isCrit ? 620 : 480;

    // Softer motion for a more minimal look
    this.vx = (Math.random() - 0.5) * 12;
    this.vy = -(isCrit ? 32 : 26);

    // Subtle emphasis on crits (no huge pop)
    this.scale = isCrit ? 1.08 : 1.0;
    this.isCrit = isCrit;
  }

  update(dtMs: number) {
    this.ageMs += dtMs;
    const t = Math.min(1, this.ageMs / this.lifeMs);

    // Ease-out drift + float
    this.x += this.vx * (dtMs / 1000) * (1 - t * 0.7);
    this.y += this.vy * (dtMs / 1000) * (1 - t * 0.5);
  }

  get done() {
    return this.ageMs >= this.lifeMs;
  }

  draw(ctx: CanvasRenderingContext2D) {
    const t = Math.min(1, this.ageMs / this.lifeMs);

    // Smooth fade (more minimal than a hard cutoff)
    const alpha = 1 - Math.pow(t, 1.7);

    // Very small pop-in
    const pop = t < 0.10 ? (0.96 + (t / 0.10) * 0.04) : 1;

    // Smaller, cleaner type
    const baseSize = this.isCrit ? 13 : 12;
    const size = Math.round(baseSize * this.scale * pop);

    // Minimal crit mark
    const text = this.isCrit ? `${this.value}×` : `${this.value}`;

    ctx.save();
    ctx.globalAlpha = 0.9 * alpha;

    // Minimal, modern font stack
    ctx.font = `${this.isCrit ? 700 : 600} ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Tiny shadow for separation (instead of neon glow)
    ctx.shadowBlur = this.isCrit ? 6 : 4;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';

    // Subtle halo for readability (thin + soft)
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.strokeText(text, this.x, this.y);

    // No colored glow
    ctx.shadowBlur = 0;

    ctx.fillStyle = this.color;
    ctx.fillText(text, this.x, this.y);

    ctx.restore();
  }
}
