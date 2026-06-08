// ============================================================
//  SHOOTING WAR — top-down shooter
//  Vanilla JS + Canvas2D, no deps. Web + mobile.
// ============================================================

(() => {
  // ---------- Canvas / sizing ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  let W = 0, H = 0;

  function resize() {
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 100));

  // ---------- DOM refs ----------
  const $kills = document.getElementById('kills');
  const $wave = document.getElementById('wave');
  const $hp = document.getElementById('hp');
  const $ammo = document.getElementById('ammo');
  const $score = document.getElementById('score');
  const $title = document.getElementById('title-screen');
  const $go = document.getElementById('game-over');
  const $goKills = document.getElementById('go-kills');
  const $goScore = document.getElementById('go-score');
  const $btnStart = document.getElementById('btn-start');
  const $btnRestart = document.getElementById('btn-restart');
  const $touchCtrls = document.getElementById('touch-controls');
  const $joyMove = document.getElementById('joy-move');
  const $joyStick = $joyMove.querySelector('.joy-stick');
  const $btnFire = document.getElementById('btn-fire');
  const $btnReload = document.getElementById('btn-reload');

  // ---------- Game state ----------
  const state = {
    running: false,
    paused: false,
    kills: 0,
    score: 0,
    wave: 1,
    hp: 100,
    maxHp: 100,
    ammo: Infinity,
    fireRate: 130,        // ms between shots
    lastShot: 0,
    time: 0,
    shake: 0,
  };

  // ---------- Player ----------
  const player = {
    x: 0, y: 0, r: 18,
    speed: 220,           // px/s
    angle: 0,             // aim direction
    invuln: 0,            // ms of invulnerability after hit
  };

  // ---------- Entities ----------
  const bullets = [];    // {x,y,vx,vy,r,life,damage}
  const enemies = [];    // {x,y,vx,vy,r,hp,maxHp,color,kind,lastShot,attackCd,flash}
  const particles = [];  // {x,y,vx,vy,life,maxLife,color,size}
  const floatingTexts = []; // {x,y,text,color,life}
  const pickups = [];    // {x,y,kind,vy}

  // ---------- Input ----------
  const keys = Object.create(null);
  const mouse = { x: W/2, y: H/2, down: false };
  const joy = { active: false, dx: 0, dy: 0, touchId: null, originX: 0, originY: 0 };
  let fireHeld = false;

  window.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === ' ' || e.key === 'f') fireHeld = true;
    if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase())) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
    if (e.key === ' ' || e.key === 'f') fireHeld = false;
  });

  // Mouse aim + click shoot
  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
    mouse.down = true;
    tryShoot();
  });
  window.addEventListener('mouseup', () => { mouse.down = false; });

  // Joystick (mobile)
  function joyUpdate(touch) {
    const r = $joyMove.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dx = touch.clientX - cx;
    const dy = touch.clientY - cy;
    const maxR = r.width / 2 - 25;
    const dist = Math.hypot(dx, dy);
    const clamp = Math.min(dist, maxR);
    const ang = Math.atan2(dy, dx);
    const nx = Math.cos(ang) * clamp;
    const ny = Math.sin(ang) * clamp;
    $joyStick.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
    // Normalize to -1..1
    joy.dx = nx / maxR;
    joy.dy = ny / maxR;
  }
  $joyMove.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    joy.active = true;
    joy.touchId = t.identifier;
    joyUpdate(t);
  }, { passive: false });
  $joyMove.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === joy.touchId) joyUpdate(t);
    }
  }, { passive: false });
  function joyEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.touchId) {
        joy.active = false; joy.touchId = null;
        joy.dx = 0; joy.dy = 0;
        $joyStick.style.transform = 'translate(-50%, -50%)';
        break;
      }
    }
  }
  $joyMove.addEventListener('touchend', joyEnd);
  $joyMove.addEventListener('touchcancel', joyEnd);

  // Fire / reload buttons
  function bindPress(btn) {
    const start = (e) => { e.preventDefault(); fireHeld = true; };
    const end = (e) => { e.preventDefault(); fireHeld = false; };
    btn.addEventListener('touchstart', start, { passive: false });
    btn.addEventListener('touchend', end, { passive: false });
    btn.addEventListener('mousedown', start);
    btn.addEventListener('mouseup', end);
    btn.addEventListener('mouseleave', end);
  }
  bindPress($btnFire);
  $btnReload.addEventListener('click', () => { /* ammo is infinite, but visual feedback */ state.ammo = Infinity; });

  // ---------- Helpers ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx*dx + dy*dy; };

  function spawnParticles(x, y, color, count = 14, speed = 220) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(speed * 0.3, speed);
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.4, 0.9),
        maxLife: 0.9,
        color, size: rand(2, 4),
      });
    }
  }
  function spawnExplosion(x, y, color) {
    spawnParticles(x, y, color, 22, 320);
    spawnParticles(x, y, '#fff', 8, 180);
    state.shake = Math.min(20, state.shake + 8);
  }
  function floatText(x, y, text, color = '#fff') {
    floatingTexts.push({ x, y, text, color, life: 0.9, maxLife: 0.9, vy: -40 });
  }

  // ---------- Bullets ----------
  function tryShoot() {
    if (!state.running) return;
    const now = performance.now();
    if (now - state.lastShot < state.fireRate) return;
    state.lastShot = now;
    // Spawn at tip of "gun" in front of player
    const nose = player.r + 4;
    const bx = player.x + Math.cos(player.angle) * nose;
    const by = player.y + Math.sin(player.angle) * nose;
    const speed = 720;
    bullets.push({
      x: bx, y: by,
      vx: Math.cos(player.angle) * speed,
      vy: Math.sin(player.angle) * speed,
      r: 4,
      life: 1.4,
      damage: 25,
    });
    // Muzzle flash
    spawnParticles(bx, by, '#ffd23f', 6, 160);
  }

  // ---------- Enemies ----------
  const ENEMY_KINDS = [
    { name: 'runner', r: 16, hp: 35, speed: 110, color: '#ff5577', contact: 12, score: 10 },
    { name: 'tank',   r: 24, hp: 90, speed: 55,  color: '#8b5cf6', contact: 20, score: 25 },
    { name: 'speedy', r: 12, hp: 20, speed: 200, color: '#4dd0ff', contact: 8,  score: 15 },
  ];

  function spawnEnemy() {
    // Spawn just off-screen at a random edge
    const side = Math.floor(Math.random() * 4);
    const margin = 40;
    let x, y;
    if (side === 0) { x = -margin; y = rand(0, H); }
    else if (side === 1) { x = W + margin; y = rand(0, H); }
    else if (side === 2) { x = rand(0, W); y = -margin; }
    else { x = rand(0, W); y = H + margin; }
    const kind = ENEMY_KINDS[Math.floor(Math.random() * ENEMY_KINDS.length)];
    enemies.push({
      x, y, vx: 0, vy: 0, r: kind.r, hp: kind.hp, maxHp: kind.hp,
      color: kind.color, kind: kind.name, contact: kind.contact,
      score: kind.score, flash: 0,
    });
  }

  function waveConfig(w) {
    // Counts grow with wave
    return {
      total: 4 + w * 2,
      perInterval: Math.max(280, 1000 - w * 60), // ms between spawns
      speedMult: 1 + (w - 1) * 0.08,
    };
  }

  const wave = {
    spawned: 0,
    total: 0,
    timer: 0,
    perInterval: 1000,
    speedMult: 1,
    active: false,
    cooldown: 0,
  };

  function startWave(n) {
    state.wave = n;
    const cfg = waveConfig(n);
    wave.spawned = 0;
    wave.total = cfg.total;
    wave.perInterval = cfg.perInterval;
    wave.speedMult = cfg.speedMult;
    wave.timer = 0;
    wave.active = true;
    wave.cooldown = 0;
    $wave.textContent = n;
  }

  function checkWaveDone(dt) {
    if (!wave.active) return;
    if (wave.spawned < wave.total) {
      wave.timer += dt * 1000;
      if (wave.timer >= wave.perInterval) {
        wave.timer = 0;
        spawnEnemy();
        wave.spawned++;
      }
    } else if (enemies.length === 0) {
      wave.active = false;
      wave.cooldown = 2.0; // 2s grace between waves
    }
  }

  // ---------- Update ----------
  let lastT = 0;
  function update(dt) {
    if (!state.running) return;
    state.time += dt;

    // Wave management
    if (!wave.active) {
      wave.cooldown -= dt;
      if (wave.cooldown <= 0) startWave(state.wave + 1);
    }
    checkWaveDone(dt);

    // Player movement
    let mx = 0, my = 0;
    if (keys['w'] || keys['arrowup']) my -= 1;
    if (keys['s'] || keys['arrowdown']) my += 1;
    if (keys['a'] || keys['arrowleft']) mx -= 1;
    if (keys['d'] || keys['arrowright']) mx += 1;
    if (joy.active) { mx = joy.dx; my = joy.dy; }
    const mag = Math.hypot(mx, my);
    if (mag > 0) {
      mx /= mag; my /= mag;
      player.x += mx * player.speed * dt;
      player.y += my * player.speed * dt;
    }
    // Clamp to screen
    player.x = clamp(player.x, player.r, W - player.r);
    player.y = clamp(player.y, player.r, H - player.r);

    // Player aim
    if (joy.active) {
      // Use joystick direction for aim when no mouse
      player.angle = Math.atan2(joy.dy, joy.dx);
    } else {
      player.angle = Math.atan2(mouse.y - player.y, mouse.x - player.x);
    }

    // Fire (auto if held)
    if (mouse.down || fireHeld) tryShoot();

    // Invuln tick
    if (player.invuln > 0) player.invuln -= dt * 1000;

    // Update bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) {
        bullets.splice(i, 1);
      }
    }

    // Update enemies (chase player)
    for (const e of enemies) {
      const dx = player.x - e.x, dy = player.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const baseSpeed = ENEMY_KINDS.find(k => k.name === e.kind).speed;
      const sp = baseSpeed * wave.speedMult;
      e.vx = (dx / d) * sp;
      e.vy = (dy / d) * sp;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      if (e.flash > 0) e.flash -= dt;
    }

    // Bullet vs enemy
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      let hit = false;
      for (const e of enemies) {
        const rr = (b.r + e.r);
        if (dist2(b, e) < rr * rr) {
          e.hp -= b.damage;
          e.flash = 0.1;
          hit = true;
          spawnParticles(b.x, b.y, '#ffd23f', 4, 140);
          if (e.hp <= 0) {
            spawnExplosion(e.x, e.y, e.color);
            floatText(e.x, e.y - 10, `+${e.score}`, '#fff');
            state.score += e.score;
            state.kills++;
            $kills.textContent = state.kills;
            $score.textContent = state.score;
            // Random drop
            if (Math.random() < 0.12) {
              pickups.push({ x: e.x, y: e.y, kind: Math.random() < 0.5 ? 'hp' : 'score', vy: 60 });
            }
            // Remove enemy (mark by hp<=0 and filter later)
            e.hp = -1;
          }
          break;
        }
      }
      if (hit) bullets.splice(i, 1);
    }
    // Cull dead enemies
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (enemies[i].hp <= 0) enemies.splice(i, 1);
    }

    // Enemy vs player
    if (player.invuln <= 0) {
      for (const e of enemies) {
        const rr = (e.r + player.r);
        if (dist2(e, player) < rr * rr) {
          state.hp -= e.contact;
          player.invuln = 800;
          state.shake = 14;
          spawnParticles(player.x, player.y, '#ff2e63', 18, 260);
          // Knockback
          const dx = player.x - e.x, dy = player.y - e.y;
          const d = Math.hypot(dx, dy) || 1;
          // Just push the enemy away so we don't re-collide instantly
          e.x -= (dx / d) * 12;
          e.y -= (dy / d) * 12;
          $hp.textContent = Math.max(0, state.hp);
          if (state.hp < 35) $hp.classList.add('low'); else $hp.classList.remove('low');
          if (state.hp <= 0) {
            gameOver();
            return;
          }
          break;
        }
      }
    }

    // Pickups
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.y += p.vy * dt;
      const rr = (p.r || 10) + player.r;
      if (dist2(p, player) < rr * rr) {
        if (p.kind === 'hp') {
          state.hp = Math.min(state.maxHp, state.hp + 25);
          floatText(p.x, p.y, '+HP', '#4ade80');
        } else {
          state.score += 50;
          floatText(p.x, p.y, '+50', '#ffd23f');
        }
        $hp.textContent = state.hp;
        $score.textContent = state.score;
        pickups.splice(i, 1);
        continue;
      }
      if (p.y > H + 30) pickups.splice(i, 1);
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // Floating texts
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const f = floatingTexts[i];
      f.y += f.vy * dt;
      f.vy *= 0.95;
      f.life -= dt;
      if (f.life <= 0) floatingTexts.splice(i, 1);
    }

    // Shake decay
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 30);
  }

  // ---------- Render ----------
  function drawPlayer() {
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle);
    // Body
    const bodyGrad = ctx.createRadialGradient(-4, -4, 2, 0, 0, player.r);
    bodyGrad.addColorStop(0, '#a0b3ff');
    bodyGrad.addColorStop(1, '#2b3580');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.arc(0, 0, player.r, 0, Math.PI * 2);
    ctx.fill();
    // Gun
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(player.r - 2, -3, 14, 6);
    // Eye
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(4, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Shield flicker
    if (player.invuln > 0) {
      ctx.save();
      ctx.globalAlpha = 0.3 + Math.sin(state.time * 30) * 0.2;
      ctx.strokeStyle = '#4dd0ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.r + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(2, e.r * 0.5, e.r * 0.9, e.r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    // Body
    const c = e.flash > 0 ? '#fff' : e.color;
    ctx.fillStyle = c;
    ctx.beginPath();
    // Different shapes per kind
    if (e.kind === 'tank') {
      ctx.rect(-e.r, -e.r, e.r * 2, e.r * 2);
    } else if (e.kind === 'speedy') {
      ctx.moveTo(e.r, 0);
      ctx.lineTo(-e.r, -e.r * 0.7);
      ctx.lineTo(-e.r, e.r * 0.7);
      ctx.closePath();
    } else {
      ctx.arc(0, 0, e.r, 0, Math.PI * 2);
    }
    ctx.fill();
    // Eyes
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-3, -4, 2.5, 0, Math.PI * 2);
    ctx.arc(5, -4, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(-3, -4, 1, 0, Math.PI * 2);
    ctx.arc(5, -4, 1, 0, Math.PI * 2);
    ctx.fill();
    // HP bar
    if (e.hp < e.maxHp) {
      const w = e.r * 1.6;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(-w/2, -e.r - 10, w, 4);
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(-w/2, -e.r - 10, w * (e.hp / e.maxHp), 4);
    }
    ctx.restore();
  }

  function render() {
    // Screen shake
    const shakeX = (Math.random() - 0.5) * state.shake;
    const shakeY = (Math.random() - 0.5) * state.shake;
    ctx.save();
    ctx.translate(shakeX, shakeY);

    // Background grid
    ctx.fillStyle = 'rgba(20,15,40,0.4)';
    const grid = 50;
    for (let x = 0; x < W; x += grid) {
      ctx.fillRect(x, 0, 1, H);
    }
    for (let y = 0; y < H; y += grid) {
      ctx.fillRect(0, y, W, 1);
    }

    // Pickups
    for (const p of pickups) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = p.kind === 'hp' ? '#4ade80' : '#ffd23f';
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.kind === 'hp' ? '+' : '$', 0, 1);
      ctx.restore();
    }

    // Enemies
    for (const e of enemies) drawEnemy(e);

    // Bullets
    for (const b of bullets) {
      ctx.save();
      const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 2);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(0.5, '#ffd23f');
      grad.addColorStop(1, 'rgba(255,210,63,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Player
    drawPlayer();

    // Particles
    for (const p of particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Floating texts
    for (const f of floatingTexts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, f.life / f.maxLife);
      ctx.fillStyle = f.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3;
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    }

    ctx.restore();
  }

  // ---------- Loop ----------
  function loop(t) {
    requestAnimationFrame(loop);
    if (!lastT) lastT = t;
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    update(dt);
    render();
  }

  // ---------- Game lifecycle ----------
  function startGame() {
    state.running = true;
    state.paused = false;
    state.kills = 0;
    state.score = 0;
    state.hp = state.maxHp;
    state.wave = 0;
    state.shake = 0;
    player.x = W / 2;
    player.y = H / 2;
    player.invuln = 0;
    bullets.length = 0;
    enemies.length = 0;
    particles.length = 0;
    floatingTexts.length = 0;
    pickups.length = 0;
    $kills.textContent = 0;
    $score.textContent = 0;
    $hp.textContent = state.hp;
    $hp.classList.remove('low');
    hideOverlay($title);
    hideOverlay($go);
    startWave(1);
  }

  function gameOver() {
    state.running = false;
    $goKills.textContent = state.kills;
    $goScore.textContent = state.score;
    showOverlay($go);
  }

  // ---------- Modal helpers (X + click-outside + ESC + inline display) ----------
  function showOverlay(el) { el.hidden = false; el.style.display = 'flex'; }
  function hideOverlay(el) { el.hidden = true; el.style.display = 'none'; }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideOverlay($title);
      hideOverlay($go);
    }
  });

  $btnStart.addEventListener('click', startGame);
  $btnRestart.addEventListener('click', startGame);

  // Pause on tab hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) state.paused = true;
    else state.paused = false;
  });

  // ---------- Boot ----------
  function boot() {
    try {
      resize();
      // Initial player position
      player.x = W / 2;
      player.y = H / 2;
      showOverlay($title);
      requestAnimationFrame(loop);
    } catch (e) {
      console.error('boot failed:', e);
      const err = document.createElement('div');
      err.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(10,5,20,0.95);color:#ff5577;font-family:monospace;padding:24px;z-index:9999;';
      err.textContent = 'Error: ' + e.message;
      document.body.appendChild(err);
    }
  }
  boot();
})();
