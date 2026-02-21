
export class AudioService {
  // Pickup (XP orb) SFX
  private static pickupUrl = 'https://files.catbox.moe/pfuoy0.mp3';
  // Player shoot SFX
  private static shootUrl = 'https://files.catbox.moe/1y36oa.mp3';

  // UI button click SFX
  private static uiClickUrl = 'https://files.catbox.moe/nxy8nc.mp3';
  // Level-up / upgrade screen SFX
  private static levelUpUrl = 'https://audiocdn.epidemicsound.com/lqmp3/01HYDYM9ZEP5B3PDGKEEH8N36S.mp3';

  // Background music (alternates)
  private static musicUrls = ['https://files.catbox.moe/jvhkxh.mp3', 'https://files.catbox.moe/qxcf2p.mp3'];

  private static enabled = true;
  private static warmed = false;

  // Volumes (0..1)
  private static sfxVolume = 0.5;
  private static basePickupVol = 0.5;
  private static baseShootVol = 0.45;
  private static baseClickVol = 0.55;
  private static baseLevelUpVol = 0.45;

  private static ctx: AudioContext | null = null;
  private static gain: GainNode | null = null;
  private static pickupBuffer: AudioBuffer | null = null;
  private static pickupLoading: Promise<void> | null = null;

  private static shootBuffer: AudioBuffer | null = null;
  private static shootLoading: Promise<void> | null = null;

  private static uiClickBuffer: AudioBuffer | null = null;
  private static uiClickLoading: Promise<void> | null = null;

  private static levelUpBuffer: AudioBuffer | null = null;
  private static levelUpLoading: Promise<void> | null = null;

  private static fallbackPickupPool: HTMLAudioElement[] = [];
  private static fallbackShootPool: HTMLAudioElement[] = [];
  private static fallbackPoolSize = 12;
  private static fallbackClickPool: HTMLAudioElement[] = [];
  private static fallbackLevelUpPool: HTMLAudioElement[] = [];
  private static fallbackPickupIndex = 0;
  private static fallbackShootIndex = 0;
  private static fallbackClickIndex = 0;
  private static fallbackLevelUpIndex = 0;

  // Music
  private static musicEls: HTMLAudioElement[] = [];
  private static musicIndex = 0;
  private static musicStarted = false;
  private static musicVolume = 0.35;

  static init(enabled: boolean) {
    this.enabled = enabled;

    // HTMLAudio fallback pools
    if (this.fallbackPickupPool.length === 0) {
      for (let i = 0; i < this.fallbackPoolSize; i++) {
        const a = new Audio(this.pickupUrl);
        a.preload = 'auto';
        a.volume = this.basePickupVol * this.sfxVolume;
        try { a.load(); } catch { /* ignore */ }
        this.fallbackPickupPool.push(a);
      }
    }

    if (this.fallbackShootPool.length === 0) {
      for (let i = 0; i < this.fallbackPoolSize; i++) {
        const a = new Audio(this.shootUrl);
        a.preload = 'auto';
        a.volume = this.baseShootVol * this.sfxVolume;
        try { a.load(); } catch { /* ignore */ }
        this.fallbackShootPool.push(a);
      }
    }

    if (this.fallbackClickPool.length === 0) {
      for (let i = 0; i < this.fallbackPoolSize; i++) {
        const a = new Audio(this.uiClickUrl);
        a.preload = 'auto';
        a.volume = this.baseClickVol * this.sfxVolume;
        try { a.load(); } catch { /* ignore */ }
        this.fallbackClickPool.push(a);
      }
    }

    if (this.fallbackLevelUpPool.length === 0) {
      // keep slightly lower volume; this SFX can be loud
      for (let i = 0; i < this.fallbackPoolSize; i++) {
        const a = new Audio(this.levelUpUrl);
        a.preload = 'auto';
        a.volume = this.baseLevelUpVol * this.sfxVolume;
        try { a.load(); } catch { /* ignore */ }
        this.fallbackLevelUpPool.push(a);
      }
    }

    if (!this.ctx) {
      try {
        const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
        const context = new AC({ latencyHint: 'interactive' }) as AudioContext;
        const gainNode = context.createGain();
        gainNode.gain.value = this.sfxVolume;
        gainNode.connect(context.destination);
        
        this.ctx = context;
        this.gain = gainNode;
      } catch (e) {
        console.error("AudioContext failed", e);
        this.ctx = null;
        this.gain = null;
      }
    }

    // WebAudio buffers
    if (this.ctx && !this.pickupLoading && !this.pickupBuffer) {
      this.pickupLoading = this.loadBuffer(this.pickupUrl).then((b) => { this.pickupBuffer = b; });
    }
    if (this.ctx && !this.shootLoading && !this.shootBuffer) {
      this.shootLoading = this.loadBuffer(this.shootUrl).then((b) => { this.shootBuffer = b; });
    }

    if (this.ctx && !this.uiClickLoading && !this.uiClickBuffer) {
      this.uiClickLoading = this.loadBuffer(this.uiClickUrl).then((b) => { this.uiClickBuffer = b; });
    }

    if (this.ctx && !this.levelUpLoading && !this.levelUpBuffer) {
      this.levelUpLoading = this.loadBuffer(this.levelUpUrl).then((b) => { this.levelUpBuffer = b; });
    }
  }

  static setEnabled(val: boolean) {
    this.enabled = val;
    if (!val) this.stopMusic();
  }

  static setSfxVolume(vol: number) {
    this.sfxVolume = Math.max(0, Math.min(1, vol));

    if (this.gain) {
      try { this.gain.gain.value = this.sfxVolume; } catch { /* ignore */ }
    }

    // Update fallback pools to follow master sfx volume
    for (const a of this.fallbackPickupPool) a.volume = this.basePickupVol * this.sfxVolume;
    for (const a of this.fallbackShootPool) a.volume = this.baseShootVol * this.sfxVolume;
    for (const a of this.fallbackClickPool) a.volume = this.baseClickVol * this.sfxVolume;
    for (const a of this.fallbackLevelUpPool) a.volume = this.baseLevelUpVol * this.sfxVolume;
  }

  static getSfxVolume() {
    return this.sfxVolume;
  }

  static unlock() {
    if (!this.enabled) return;

    const context = this.ctx;
    if (context) {
      const afterRunning = () => {
        if (!this.warmed) {
          this.tryWarm();
        }
      };

      if (context.state !== 'running') {
        context.resume().then(afterRunning).catch(() => {
          // ignore
        });
      } else {
        afterRunning();
      }
    }

    // Warm up fallback pools (helps on mobile & removes first-play delay)
    const a = this.fallbackPickupPool[0];
    if (a) {
      const originalVolume = a.volume;
      a.volume = 0.01;
      const p = a.play();
      if (p) {
        p.then(() => {
          a.pause();
          a.currentTime = 0;
          a.volume = originalVolume;
        }).catch(() => {
          a.volume = originalVolume;
        });
      }
    }

    const s = this.fallbackShootPool[0];
    if (s) {
      const originalVolume = s.volume;
      s.volume = 0.01;
      const p = s.play();
      if (p) {
        p.then(() => {
          s.pause();
          s.currentTime = 0;
          s.volume = originalVolume;
        }).catch(() => {
          s.volume = originalVolume;
        });
      }
    }

    const c = this.fallbackClickPool[0];
    if (c) {
      const originalVolume = c.volume;
      c.volume = 0.01;
      const p = c.play();
      if (p) {
        p.then(() => {
          c.pause();
          c.currentTime = 0;
          c.volume = originalVolume;
        }).catch(() => {
          c.volume = originalVolume;
        });
      }
    }

    const l = this.fallbackLevelUpPool[0];
    if (l) {
      const originalVolume = l.volume;
      l.volume = 0.01;
      const p = l.play();
      if (p) {
        p.then(() => {
          l.pause();
          l.currentTime = 0;
          l.volume = originalVolume;
        }).catch(() => {
          l.volume = originalVolume;
        });
      }
    }
  }

  static playPickupSfx() {
    if (!this.enabled) return;

    const context = this.ctx;
    const gainNode = this.gain;
    const buf = this.pickupBuffer;

    if (context && gainNode && buf && context.state === 'running') {
      try {
        const src = context.createBufferSource();
        src.buffer = buf;
        src.connect(gainNode);
        src.start(0);
        return;
      } catch {
        // cai no fallback
      }
    }

    const audio = this.fallbackPickupPool[this.fallbackPickupIndex];
    if (audio) {
      try { audio.currentTime = 0; } catch { /* ignore */ }
      const p = audio.play();
      if (p) p.catch(() => {});
      this.fallbackPickupIndex = (this.fallbackPickupIndex + 1) % this.fallbackPoolSize;
    }
  }

  static playShootSfx() {
    if (!this.enabled) return;

    const context = this.ctx;
    const gainNode = this.gain;
    const buf = this.shootBuffer;

    if (context && gainNode && buf && context.state === 'running') {
      try {
        // Slightly lower volume than pickup so it doesn't get annoying
        const g = context.createGain();
        g.gain.value = 0.45;
        g.connect(gainNode);

        const src = context.createBufferSource();
        src.buffer = buf;
        src.connect(g);
        src.start(0);
        return;
      } catch {
        // fallback below
      }
    }

    const audio = this.fallbackShootPool[this.fallbackShootIndex];
    if (audio) {
      try { audio.currentTime = 0; } catch { /* ignore */ }
      const p = audio.play();
      if (p) p.catch(() => {});
      this.fallbackShootIndex = (this.fallbackShootIndex + 1) % this.fallbackPoolSize;
    }
  }

  private static tryWarm() {
    const context = this.ctx;
    const buf = this.pickupBuffer;
    if (!context || !buf || !context.destination) return;
    try {
      const g = context.createGain();
      g.gain.value = 0.0001; 
      g.connect(context.destination);
      const src = context.createBufferSource();
      src.buffer = buf;
      src.connect(g);
      src.start(0);
      src.stop(context.currentTime + 0.03);
      this.warmed = true;
    } catch {
      // ignore
    }
  }

  private static async loadBuffer(url: string): Promise<AudioBuffer | null> {
    const context = this.ctx;
    if (!context) return null;
    try {
      const res = await fetch(url, { mode: 'cors', cache: 'force-cache' });
      const arr = await res.arrayBuffer();

      const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
        const maybePromise: any = (context as any).decodeAudioData(arr, resolve, reject);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(resolve).catch(reject);
        }
      });

      return decoded;
    } catch {
      return null;
    }
  }

  static playUiClickSfx() {
    if (!this.enabled) return;

    const context = this.ctx;
    const gainNode = this.gain;
    const buf = this.uiClickBuffer;

    if (context && gainNode && buf && context.state === 'running') {
      try {
        const src = context.createBufferSource();
        src.buffer = buf;
        src.connect(gainNode);
        src.start(0);
        return;
      } catch {
        // fallback
      }
    }

    if (this.fallbackClickPool.length === 0) return;
    const audio = this.fallbackClickPool[this.fallbackClickIndex];
    if (audio) {
      try { audio.currentTime = 0; } catch { /* ignore */ }
      const p = audio.play();
      if (p) p.catch(() => {});
      this.fallbackClickIndex = (this.fallbackClickIndex + 1) % this.fallbackClickPool.length;
    }
  }

  static playLevelUpSfx() {
    if (!this.enabled) return;

    const context = this.ctx;
    const gainNode = this.gain;
    const buf = this.levelUpBuffer;

    if (context && gainNode && buf && context.state === 'running') {
      try {
        const src = context.createBufferSource();
        src.buffer = buf;
        src.connect(gainNode);
        src.start(0);
        return;
      } catch {
        // fallback
      }
    }

    if (this.fallbackLevelUpPool.length === 0) return;
    const audio = this.fallbackLevelUpPool[this.fallbackLevelUpIndex];
    if (audio) {
      try { audio.currentTime = 0; } catch { /* ignore */ }
      const p = audio.play();
      if (p) p.catch(() => {});
      this.fallbackLevelUpIndex = (this.fallbackLevelUpIndex + 1) % this.fallbackLevelUpPool.length;
    }
  }

  static startMusic() {
    if (!this.enabled) return;
    if (this.musicStarted) return;

    // Use HTMLAudio for long background music (simpler & low overhead)
    if (this.musicEls.length === 0) {
      this.musicEls = this.musicUrls.map((u) => {
        const a = new Audio(u);
        a.preload = 'auto';
        a.loop = false; // we'll alternate manually
        a.volume = this.musicVolume;
        return a;
      });

      // alternate when track ends
      for (const a of this.musicEls) {
        a.addEventListener('ended', () => {
          if (!this.musicStarted) return;
          this.musicIndex = (this.musicIndex + 1) % this.musicEls.length;
          const next = this.musicEls[this.musicIndex];
          if (!next) return;
          next.volume = this.musicVolume;
          const p = next.play();
          if (p) p.catch(() => {});
        });
      }
    }

    this.musicStarted = true;
    const current = this.musicEls[this.musicIndex] || this.musicEls[0];
    if (current) {
      current.volume = this.musicVolume;
      const p = current.play();
      if (p) p.catch(() => {});
    }
  }

  static stopMusic() {
    this.musicStarted = false;
    for (const a of this.musicEls) {
      try { a.pause(); } catch { /* ignore */ }
      try { a.currentTime = 0; } catch { /* ignore */ }
    }
  }

  static setMusicVolume(vol: number) {
    this.musicVolume = Math.max(0, Math.min(1, vol));
    for (const a of this.musicEls) {
      a.volume = this.musicVolume;
    }
  }

}

