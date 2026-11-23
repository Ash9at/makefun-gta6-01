// render.js — everything the player sees: the city, the cars, the HUD.
//
// The world is drawn in camera space (translate by the camera, cull to the
// view), then the HUD is drawn in screen space. Buildings get a cheap 2.5D
// lift: the roof is drawn shifted up-left by an amount set by the building's
// height, the gap filled with a darker wall tone, and windows dotted over the
// roof face — lit windows multiply as the day darkens, which sells the
// day-night cycle more than any sky colour.

const Ren = (() => {
  const { clamp, lerp } = RNG;

  // --- day and night -------------------------------------------------------
  // dayTime runs 0..1 over a day; 0.30 is dawn, 0.55 noon, 0.80 dusk.
  function sunInfo(dayTime) {
    const hour = dayTime * 24;
    const elev = Math.sin(((hour - 6) / 12) * Math.PI); // -1..1, up during 6..18
    const day = clamp(elev * 1.6 + 0.25, 0, 1);          // 0 night, 1 full day
    const dusk = clamp(1 - Math.abs(elev) * 3.2, 0, 1) * (hour > 4 && hour < 20 ? 1 : 0);
    return { hour, day, dusk, night: 1 - day };
  }

  function clockText(dayTime) {
    const mins = Math.floor(dayTime * 24 * 60);
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp(Math.round(((n >> 16) & 255) * f), 0, 255);
    const g = clamp(Math.round(((n >> 8) & 255) * f), 0, 255);
    const b = clamp(Math.round((n & 255) * f), 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  // --- ground ---------------------------------------------------------------
  function drawGround(G, ctx, view) {
    const W = G.world;
    // Base: block pavement everywhere in the city, then streets on top.
    ctx.fillStyle = '#9aa0a3';
    ctx.fillRect(view.x, view.y, view.w, view.h);
    // Sand and sea to the south.
    ctx.fillStyle = '#e8cf92';
    ctx.fillRect(0, CFG.BEACH_Y, CFG.WORLD_W, CFG.WATER_Y - CFG.BEACH_Y);
    const grad = ctx.createLinearGradient(0, CFG.WATER_Y, 0, CFG.WORLD_H);
    grad.addColorStop(0, '#3f8fae');
    grad.addColorStop(1, '#1d5d7d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, CFG.WATER_Y, CFG.WORLD_W, CFG.WORLD_H - CFG.WATER_Y);
    // Lazy wave lines, sliding with game time.
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let y = CFG.WATER_Y + 26; y < CFG.WORLD_H; y += 44) {
      for (let x = -40; x < CFG.WORLD_W; x += 130) {
        const wx = x + Math.sin(G.time * 0.7 + y * 0.05 + x * 0.01) * 9;
        ctx.moveTo(wx, y);
        ctx.lineTo(wx + 44, y);
      }
    }
    ctx.stroke();
    // Asphalt bands. Vertical streets end at the last street's south edge:
    // beyond it is open sand, not tarmac.
    ctx.fillStyle = '#3c4148';
    for (let i = 0; i <= CFG.COLS; i++) ctx.fillRect(i * CFG.PITCH, 0, CFG.ROAD, CFG.BEACH_Y);
    for (let j = 0; j <= CFG.ROWS; j++) ctx.fillRect(0, j * CFG.PITCH, CFG.WORLD_W, CFG.ROAD);
    // Lane dashes.
    ctx.strokeStyle = 'rgba(240,220,150,0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([16, 20]);
    ctx.beginPath();
    for (let i = 0; i <= CFG.COLS; i++) {
      ctx.moveTo(World.streetCX(i), 0);
      ctx.lineTo(World.streetCX(i), CFG.BEACH_Y);
    }
    for (let j = 0; j <= CFG.ROWS; j++) {
      ctx.moveTo(0, World.streetCY(j));
      ctx.lineTo(CFG.WORLD_W, World.streetCY(j));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Crosswalks at junctions.
    ctx.fillStyle = 'rgba(235,235,235,0.35)';
    for (let i = 0; i <= CFG.COLS; i++) {
      for (let j = 0; j <= CFG.ROWS; j++) {
        const cx = World.streetCX(i), cy = World.streetCY(j);
        for (let s = -30; s <= 30; s += 15) {
          ctx.fillRect(cx + s - 4, cy - CFG.ROAD / 2 + 3, 8, 10);
          ctx.fillRect(cx + s - 4, cy + CFG.ROAD / 2 - 13, 8, 10);
        }
      }
    }
    // The plaza: open patterned ground where the rampage ring sits.
    const plaza = W.plaza;
    ctx.fillStyle = '#b8a888';
    ctx.beginPath();
    ctx.arc(plaza.x, plaza.y, plaza.r + 26, 0, Math.PI * 2);
    ctx.fill();
    // The pier: wooden deck over the water, with posts.
    const pier = W.pier;
    ctx.fillStyle = '#8a6844';
    ctx.fillRect(pier.x, pier.y, pier.w, pier.h);
    ctx.strokeStyle = 'rgba(60,40,20,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let y = pier.y + 14; y < pier.y + pier.h; y += 26) {
      ctx.moveTo(pier.x + 3, y);
      ctx.lineTo(pier.x + pier.w - 3, y);
    }
    ctx.stroke();
    // Lighthouse: white and red bands on a round tower.
    const lh = W.lighthouse;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.arc(lh.x + 4, lh.y + 6, lh.r + 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8e4da';
    ctx.beginPath(); ctx.arc(lh.x, lh.y, lh.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c33b2e';
    ctx.beginPath(); ctx.arc(lh.x, lh.y, lh.r * 0.62, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd76a';
    ctx.beginPath(); ctx.arc(lh.x, lh.y, lh.r * 0.3, 0, Math.PI * 2); ctx.fill();
  }

  // --- buildings ------------------------------------------------------------
  function windowLayout(b) {
    if (b._win) return b._win;
    const rng = RNG.stream(b.seed);
    const cols = Math.max(2, Math.floor(b.w / 17));
    const rows = Math.max(2, Math.floor(b.h / 17));
    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells.push({ c, r, lit: rng.next(), warm: rng.pick(['#ffd76a', '#ffe9b0', '#bfe3ff']) });
      }
    }
    b._win = { cells, cols, rows };
    return b._win;
  }

  function drawBuilding(G, ctx, b, sun) {
    const lift = b.height;
    const ox = -lift * 0.38, oy = -lift * 0.55;
    // Shadow, then the wall block, then the lifted roof.
    ctx.fillStyle = 'rgba(20,16,10,0.30)';
    ctx.fillRect(b.x + 5, b.y + 7, b.w, b.h);
    ctx.fillStyle = shade(b.wall, 0.72);
    ctx.fillRect(b.x, b.y, b.w, b.h);
    const rx = b.x + ox, ry = b.y + oy;
    const roofBase = { flat: '#b9b3a8', parapet: '#a49a8a', terrace: '#c2a878', dome: '#9fb6c9', solar: '#8d99a6', garden: '#7da05f', tiled: '#b45a41' }[b.roofStyle];
    ctx.fillStyle = roofBase;
    ctx.fillRect(rx, ry, b.w, b.h);
    ctx.strokeStyle = 'rgba(40,30,20,0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(rx, ry, b.w, b.h);
    if (b.roofStyle === 'dome') {
      ctx.fillStyle = 'rgba(230,240,250,0.75)';
      ctx.beginPath();
      ctx.arc(rx + b.w / 2, ry + b.h / 2, Math.min(b.w, b.h) * 0.3, 0, Math.PI * 2);
      ctx.fill();
    } else if (b.roofStyle === 'solar') {
      ctx.fillStyle = '#274b73';
      const pw = b.w / 4, ph = b.h / 3;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) ctx.fillRect(rx + 5 + c * pw, ry + 5 + r * ph, pw - 8, ph - 8);
    } else if (b.roofStyle === 'garden') {
      ctx.fillStyle = '#5d8a46';
      ctx.fillRect(rx + 8, ry + 8, b.w - 16, b.h - 16);
      ctx.fillStyle = '#c96f4a';
      ctx.fillRect(rx + b.w * 0.3, ry + b.h * 0.3, b.w * 0.4, b.h * 0.4);
    } else if (b.roofStyle === 'tiled') {
      ctx.strokeStyle = 'rgba(90,40,25,0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let x = rx + 8; x < rx + b.w; x += 13) { ctx.moveTo(x, ry + 3); ctx.lineTo(x, ry + b.h - 3); }
      ctx.stroke();
    } else if (b.roofStyle === 'terrace') {
      ctx.fillStyle = 'rgba(120,84,50,0.8)';
      ctx.fillRect(rx + 10, ry + 10, 20, 12);
      ctx.fillRect(rx + b.w - 34, ry + b.h - 24, 22, 13);
    }
    // Windows over the roof face; at night the lit share climbs.
    const { cells, cols, rows } = windowLayout(b);
    const cw = b.w / cols, ch = b.h / rows;
    const litShare = 0.12 + sun.night * 0.55;
    for (const cell of cells) {
      const wx = rx + cell.c * cw + cw * 0.28, wy = ry + cell.r * ch + ch * 0.28;
      if (cell.lit < litShare) {
        ctx.fillStyle = cell.warm;
        ctx.fillRect(wx, wy, cw * 0.44, ch * 0.44);
      } else if (sun.day > 0.4) {
        ctx.fillStyle = 'rgba(70,95,120,0.55)';
        ctx.fillRect(wx, wy, cw * 0.44, ch * 0.44);
      }
    }
    // Signs for named places, readable as you pass.
    if (b.name) {
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const tw = ctx.measureText(b.name).width + 14;
      ctx.fillStyle = b.kind === 'station' ? '#274b73' : b.kind === 'hospital' ? '#b03030' : 'rgba(24,20,16,0.85)';
      ctx.fillRect(b.x + b.w / 2 - tw / 2, b.y + b.h + 2, tw, 19);
      ctx.fillStyle = '#ffe9b0';
      ctx.fillText(b.name, b.x + b.w / 2, b.y + b.h + 16);
    }
  }

  function drawProps(G, ctx, sun) {
    for (const palm of G.world.palms) {
      ctx.strokeStyle = '#7a5c38';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(palm.x, palm.y);
      ctx.lineTo(palm.x + 3, palm.y - 13 * palm.s);
      ctx.stroke();
      ctx.strokeStyle = '#3f8f4f';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let f = 0; f < 6; f++) {
        const a = (f / 6) * Math.PI * 2 + palm.x * 0.01;
        ctx.moveTo(palm.x + 3, palm.y - 13 * palm.s);
        ctx.quadraticCurveTo(
          palm.x + 3 + Math.cos(a) * 10 * palm.s, palm.y - 13 * palm.s - 4,
          palm.x + 3 + Math.cos(a) * 17 * palm.s, palm.y - 13 * palm.s + 5 * palm.s,
        );
      }
      ctx.stroke();
    }
    // Streetlight poles; their pools are drawn in the night pass.
    ctx.fillStyle = '#4a4f57';
    for (const l of G.world.lights) ctx.fillRect(l.x - 2, l.y - 2, 4, 4);
  }

  // --- vehicles and people ----------------------------------------------------
  function drawCar(G, ctx, car, sun) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle + car.slip * 0.4);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(-19, -9 + 4, 42, 22);
    ctx.fillStyle = car.wreck ? shade(car.color === '#e8ecf2' ? '#888888' : car.color, 0.55) : car.color;
    roundRect(ctx, -21, -11, 44, 22, 6);
    ctx.fill();
    if (car.kind === 'police') {
      ctx.fillStyle = '#274b73';
      ctx.fillRect(-8, -11, 15, 22);
      ctx.fillStyle = '#e8ecf2';
      ctx.fillRect(-21, -11, 7, 22);
      // Light bar: red and blue halves, flashing with game time.
      const flash = Math.sin(G.time * 14 + car.id) > 0;
      ctx.fillStyle = flash ? '#ff4444' : '#aa2222';
      ctx.fillRect(-4, -6, 8, 6);
      ctx.fillStyle = flash ? '#2266cc' : '#4499ff';
      ctx.fillRect(-4, 0, 8, 6);
    }
    ctx.fillStyle = '#1d2733';
    roundRect(ctx, 2, -8, 10, 16, 3); ctx.fill();      // windshield block
    ctx.fillStyle = '#31445a';
    roundRect(ctx, -13, -8, 9, 16, 3); ctx.fill();     // cabin
    ctx.fillStyle = '#14181e';
    ctx.fillRect(-19, -13, 9, 4); ctx.fillRect(-19, 9, 9, 4);
    ctx.fillRect(12, -13, 9, 4); ctx.fillRect(12, 9, 9, 4);
    if (car.isObjectiveCar) {
      ctx.strokeStyle = '#ffd76a';
      ctx.lineWidth = 2;
      roundRect(ctx, -23, -13, 48, 26, 7);
      ctx.stroke();
    }
    ctx.restore();
    if (car.smoke > 0.4 && Math.random() < 0.5) {
      G.particles.push({ x: car.x, y: car.y - 6, vx: RNG.stream(car.id).range(-6, 6), vy: -26, t: 0, life: 1.1, color: 'rgba(60,60,60,0.5)', size: 5 });
      car.smoke = 0;
    }
  }

  function drawPed(G, ctx, ped) {
    ctx.save();
    ctx.translate(ped.x, ped.y);
    if (ped.state === 'down') {
      ctx.rotate(ped.angle + Math.PI / 2);
      ctx.fillStyle = ped.color;
      roundRect(ctx, -11, -5, 22, 10, 5); ctx.fill();
      ctx.fillStyle = ped.skin;
      ctx.beginPath(); ctx.arc(13, 0, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
    ctx.rotate(ped.angle);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(0, 3, 9, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ped.color;
    roundRect(ctx, -6, -7, 13, 14, 5); ctx.fill();
    ctx.fillStyle = ped.skin;
    ctx.beginPath(); ctx.arc(3, 0, 5.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (ped.state === 'hail') {
      const bob = Math.sin(G.time * 6 + ped.id) * 3;
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd76a';
      ctx.fillText('TAXI $', ped.x, ped.y - 24 + bob);
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPickupsAndMarkers(G, ctx) {
    // Cash drops glitter where they fell.
    for (const drop of G.drops) {
      const pulse = 1 + Math.sin(G.time * 5 + drop.x) * 0.15;
      ctx.fillStyle = '#3fa34d';
      ctx.save();
      ctx.translate(drop.x, drop.y);
      ctx.scale(pulse, pulse);
      ctx.fillRect(-7, -4, 14, 8);
      ctx.fillStyle = '#cfe8cf';
      ctx.fillRect(-7, -1, 14, 2);
      ctx.restore();
    }
    // Job briefcases.
    if (G.job && G.job.id === 'drops' && !G.job.done) {
      for (const d of G.job.data.drops) {
        if (d.taken) continue;
        ctx.fillStyle = '#6e4a2f';
        ctx.fillRect(d.x - 8, d.y - 6, 16, 12);
        ctx.fillStyle = '#ffd76a';
        ctx.fillRect(d.x - 8, d.y - 1, 16, 2);
      }
    }
    // The pier crate.
    if (G.job && G.job.id === 'package' && G.job.stage === 'pickup') {
      const t = G.job.target;
      ctx.fillStyle = '#7a5c38';
      ctx.fillRect(t.x - 10, t.y - 10, 20, 20);
      ctx.strokeStyle = '#4c3a22';
      ctx.strokeRect(t.x - 10, t.y - 10, 20, 20);
    }
    // Objective beacon: a pillar of light you can see across town.
    const target = G.objectiveTarget();
    if (target) {
      const pulse = 0.55 + Math.sin(G.time * 4) * 0.2;
      const grad = ctx.createLinearGradient(0, target.y - 190, 0, target.y);
      grad.addColorStop(0, 'rgba(255,215,106,0)');
      grad.addColorStop(1, `rgba(255,215,106,${pulse})`);
      ctx.fillStyle = grad;
      ctx.fillRect(target.x - 9, target.y - 190, 18, 190);
      ctx.fillStyle = '#ffd76a';
      ctx.beginPath();
      ctx.arc(target.x, target.y, 13 + Math.sin(G.time * 4) * 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7a5a10';
      ctx.beginPath();
      ctx.arc(target.x, target.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Rampage ring at the plaza.
    const plaza = G.world.plaza;
    if (G.rampage.active || G.rampage.cooldown <= 0) {
      ctx.strokeStyle = G.rampage.active ? '#ff5fa2' : 'rgba(255,95,162,0.55)';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(plaza.x, plaza.y, plaza.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (!G.rampage.active) {
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ff5fa2';
        ctx.fillText('RAMPAGE', plaza.x, plaza.y - plaza.r - 8);
      }
    }
  }

  function drawPlayer(G, ctx) {
    const p = G.player;
    if (p.car) return; // the car is the body while driving
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(0, 3, 10, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0f7d8c'; // teal jacket: the one outfit in Solmaris
    roundRect(ctx, -7, -8, 15, 16, 6); ctx.fill();
    ctx.fillStyle = '#f2c79b';
    ctx.beginPath(); ctx.arc(4, 0, 5.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#20303c';
    ctx.beginPath(); ctx.arc(5.5, 0, 3.4, 0, Math.PI * 2); ctx.fill(); // cap
    if (p.punchT > 0) {
      ctx.strokeStyle = '#f2c79b';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(8, 4);
      ctx.lineTo(8 + p.punchT * 60, 6);
      ctx.stroke();
    }
    ctx.restore();
    // Aim line while the mouse is held.
    if (G.mouse.down && !p.car) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(p.angle) * 120, p.y + Math.sin(p.angle) * 120);
      ctx.stroke();
    }
  }

  function drawEffects(G, ctx) {
    for (const s of G.skids) {
      ctx.strokeStyle = `rgba(20,20,20,${0.35 * s.t})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
    }
    for (const t of G.tracers) {
      ctx.strokeStyle = `rgba(255,230,150,${t.t * 1.6})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(t.x1, t.y1);
      ctx.lineTo(t.x2, t.y2);
      ctx.stroke();
    }
    for (const pt of G.particles) {
      ctx.globalAlpha = clamp(pt.t / pt.life, 0, 1);
      ctx.fillStyle = pt.color;
      if (pt.glyph) {
        ctx.font = `bold ${pt.size * 3}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(pt.glyph, pt.x, pt.y);
      } else {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size * (pt.t / pt.life), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    for (const f of G.floaters) {
      ctx.globalAlpha = clamp(f.t / 1.2, 0, 1);
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawNight(G, ctx, view, sun) {
    if (sun.night <= 0.02) return;
    ctx.fillStyle = `rgba(10,14,40,${sun.night * 0.42})`;
    ctx.fillRect(view.x, view.y, view.w, view.h);
    if (sun.dusk > 0.05) {
      ctx.fillStyle = `rgba(255,110,50,${sun.dusk * 0.10})`;
      ctx.fillRect(view.x, view.y, view.w, view.h);
    }
    // Light pools: punch soft holes of warmth around lamps and the lighthouse.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const pool = (x, y, r, a) => {
      const g = ctx.createRadialGradient(x, y, 2, x, y, r);
      g.addColorStop(0, `rgba(255,205,110,${a * sun.night})`);
      g.addColorStop(1, 'rgba(255,205,110,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    };
    for (const l of G.world.lights) {
      if (l.x > view.x - 60 && l.x < view.x + view.w + 60 && l.y > view.y - 60 && l.y < view.y + view.h + 60) pool(l.x, l.y, 40, 0.13);
    }
    const lh = G.world.lighthouse;
    pool(lh.x, lh.y, 90, 0.30);
    // Headlights on moving cars.
    for (const car of G.cars) {
      if (car.speed === 0 && car.kind === 'parked') continue;
      const hx = car.x + Math.cos(car.angle) * 22, hy = car.y + Math.sin(car.angle) * 22;
      pool(hx, hy, 52, 0.13);
    }
    ctx.restore();
  }

  // --- HUD ---------------------------------------------------------------------
  function drawMinimap(G, ctx) {
    const w = 204, h = 176, x = 14, y = G.view.h - h - 14;
    const sx = w / CFG.WORLD_W, sy = h / CFG.WORLD_H;
    ctx.save();
    ctx.fillStyle = 'rgba(12,18,26,0.82)';
    roundRect(ctx, x - 3, y - 3, w + 6, h + 6, 8); ctx.fill();
    ctx.beginPath();
    roundRect(ctx, x, y, w, h, 6);
    ctx.clip();
    ctx.fillStyle = '#585f4a';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#2c6d8f';
    ctx.fillRect(x, y + CFG.WATER_Y * sy, w, (CFG.WORLD_H - CFG.WATER_Y) * sy);
    ctx.fillStyle = '#d9bd7f';
    ctx.fillRect(x, y + CFG.BEACH_Y * sy, w, (CFG.WATER_Y - CFG.BEACH_Y) * sy);
    ctx.fillStyle = '#31363d';
    for (let i = 0; i <= CFG.COLS; i++) ctx.fillRect(x + i * CFG.PITCH * sx, y, CFG.ROAD * sx, CFG.CITY_H * sy);
    for (let j = 0; j <= CFG.ROWS; j++) ctx.fillRect(x, y + j * CFG.PITCH * sy, w, CFG.ROAD * sy);
    const dot = (wx, wy, color, r) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + wx * sx, y + wy * sy, r, 0, Math.PI * 2);
      ctx.fill();
    };
    // The pier and the job/taxi targets.
    ctx.fillStyle = '#8a6844';
    ctx.fillRect(x + G.world.pier.x * sx, y + G.world.pier.y * sy, G.world.pier.w * sx, G.world.pier.h * sy);
    const target = G.objectiveTarget();
    if (target) {
      const pulse = 3 + Math.sin(G.time * 5) * 1.2;
      dot(target.x, target.y, '#ffd76a', pulse);
    }
    if (G.taxi) dot(G.taxi.dest.x, G.taxi.dest.y, '#ffe14d', 3);
    for (const car of G.cars) if (car.kind === 'police') dot(car.x, car.y, '#5aa2ff', 2.4);
    // Player arrow.
    const p = G.player;
    ctx.save();
    ctx.translate(x + p.x * sx, y + p.y * sy);
    ctx.rotate(p.angle);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.restore();
    // North marker.
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd76a';
    ctx.fillText('N', x + w - 10, y + 16);
    ctx.beginPath();
    ctx.moveTo(x + w - 10, y + 20);
    ctx.lineTo(x + w - 14, y + 28);
    ctx.lineTo(x + w - 6, y + 28);
    ctx.closePath();
    ctx.fill();
  }

  function drawHUD(G, ctx) {
    const p = G.player;
    const sun = sunInfo(G.dayTime);
    ctx.textAlign = 'right';
    // Cash and respect, top right.
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillStyle = '#7ddc7d';
    ctx.fillText(`$${p.cash.toLocaleString('en-US')}`, G.view.w - 18, 36);
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillStyle = '#e8e4da';
    ctx.fillText(`RESPECT ${p.respect}   SCORE ${p.score}`, G.view.w - 18, 58);
    // Wanted stars.
    const stars = G.stars();
    ctx.font = '26px system-ui, sans-serif';
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i < stars ? '#ffd76a' : 'rgba(255,255,255,0.22)';
      ctx.fillText('★', G.view.w - 18 - (4 - i) * 28, 88);
    }
    // Clock and district.
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillStyle = '#ffd76a';
    const icon = sun.day > 0.5 ? '☀' : '☾';
    ctx.fillText(`${icon} ${clockText(G.dayTime)}  ·  ${World.districtAt(p.x, p.y)}`, G.view.w - 18, 112);

    // Objective panel, top left.
    const label = G.objectiveLabel();
    if (label) {
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(12,18,26,0.72)';
      const title = G.job && !G.job.done ? Mis.JOBS[G.job.index].title : G.taxi ? 'Taxi fare' : 'Free roam';
      ctx.font = 'bold 15px system-ui, sans-serif';
      const tw = Math.max(ctx.measureText(title).width, ctx.measureText(label).width) + 24;
      roundRect(ctx, 14, 14, tw, 56, 8); ctx.fill();
      ctx.fillStyle = '#ffd76a';
      ctx.fillText(title.toUpperCase(), 26, 37);
      ctx.fillStyle = '#e8e4da';
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillText(label, 26, 59);
      const t = G.objectiveTarget();
      if (t) {
        const d = Math.round(RNG.dist(p.x, p.y, t.x, t.y) / 10);
        ctx.fillStyle = '#9fd8ff';
        ctx.fillText(`${d} m`, 26 + ctx.measureText(label).width + 12, 59);
      }
      // Timers get a draining bar under the panel.
      const timed = (G.job && !G.job.done && G.job.timer > 0) || G.taxi;
      if (timed) {
        const remain = G.taxi ? G.taxi.timer : G.job.timer;
        const total = G.taxi ? G.taxi.totalTime : (G.job.id === 'package' ? 150 : 180);
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillRect(14, 76, tw, 6);
        ctx.fillStyle = remain < 20 ? '#ff5f5f' : '#ffd76a';
        ctx.fillRect(14, 76, tw * clamp(remain / total, 0, 1), 6);
      }
    }
    if (G.rampage.active) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.fillStyle = '#ff5fa2';
      ctx.fillText(`RAMPAGE ${G.rampage.points} pts · ${Math.ceil(G.rampage.timeLeft)}s`, G.view.w / 2, 30);
    }
    // Health and, when driving, the speedometer: bottom right.
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(12,18,26,0.72)';
    roundRect(ctx, G.view.w - 224, G.view.h - 58, 210, 44, 8); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(G.view.w - 212, G.view.h - 32, 120, 9);
    ctx.fillStyle = p.hp > 30 ? '#7ddc7d' : '#ff5f5f';
    ctx.fillRect(G.view.w - 212, G.view.h - 32, 120 * clamp(p.hp / 100, 0, 1), 9);
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillStyle = '#e8e4da';
    ctx.fillText('HEALTH', G.view.w - 212, G.view.h - 38);
    if (p.car) {
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.fillStyle = '#ffd76a';
      ctx.fillText(`${Math.round(Math.abs(p.car.speed) * 0.36)}`, G.view.w - 78, G.view.h - 24);
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = '#e8e4da';
      ctx.fillText('km/h', G.view.w - 40, G.view.h - 24);
    }
    // Bust meter while the police have you pinned.
    if (G.bust > 0.02) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillStyle = '#ff5f5f';
      ctx.fillText('BUSTED IN…', G.view.w / 2, G.view.h - 96);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(G.view.w / 2 - 110, G.view.h - 88, 220, 10);
      ctx.fillStyle = '#ff5f5f';
      ctx.fillRect(G.view.w / 2 - 110, G.view.h - 88, 220 * G.bust, 10);
    }
    // Toasts, top centre, newest last.
    ctx.textAlign = 'center';
    G.toasts.forEach((t, i) => {
      ctx.globalAlpha = clamp(t.t / 0.8, 0, 1);
      ctx.font = 'bold 16px system-ui, sans-serif';
      const tw = ctx.measureText(t.text).width + 26;
      ctx.fillStyle = 'rgba(12,18,26,0.78)';
      roundRect(ctx, G.view.w / 2 - tw / 2, 118 + i * 34, tw, 27, 7); ctx.fill();
      ctx.fillStyle = '#ffe9b0';
      ctx.fillText(t.text, G.view.w / 2, 137 + i * 34);
    });
    ctx.globalAlpha = 1;
    // Dialogue panel, bottom centre.
    if (G.dialogue) {
      const d = G.dialogue;
      const line = d.lines[d.idx];
      ctx.fillStyle = 'rgba(10,14,22,0.88)';
      roundRect(ctx, G.view.w / 2 - 330, G.view.h - 142, 660, 78, 10); ctx.fill();
      ctx.textAlign = 'left';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.fillStyle = '#ffd76a';
      ctx.fillText(d.speaker.toUpperCase(), G.view.w / 2 - 312, G.view.h - 118);
      ctx.font = '15px system-ui, sans-serif';
      ctx.fillStyle = '#f2efe8';
      wrapText(ctx, line, G.view.w / 2 - 312, G.view.h - 96, 624, 19);
      ctx.textAlign = 'right';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('E ▸', G.view.w / 2 + 312, G.view.h - 76);
    }
  }

  function wrapText(ctx, text, x, y, maxW, lineH) {
    const words = text.split(' ');
    let line = '', yy = y;
    for (const word of words) {
      const trial = line ? `${line} ${word}` : word;
      if (ctx.measureText(trial).width > maxW && line) {
        ctx.fillText(line, x, yy);
        line = word;
        yy += lineH;
      } else line = trial;
    }
    if (line) ctx.fillText(line, x, yy);
  }

  // --- screens ------------------------------------------------------------------
  function drawTitle(G, ctx) {
    // The city at dusk behind, panning slowly; the name over it.
    const grad = ctx.createLinearGradient(0, 0, 0, G.view.h);
    grad.addColorStop(0, 'rgba(30,16,48,0.25)');
    grad.addColorStop(0.6, 'rgba(60,20,40,0.35)');
    grad.addColorStop(1, 'rgba(10,10,20,0.78)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, G.view.w, G.view.h);
    ctx.textAlign = 'center';
    ctx.font = '900 92px system-ui, sans-serif';
    ctx.fillStyle = '#ffd76a';
    ctx.fillText('SOLMARIS', G.view.w / 2, 218);
    ctx.fillStyle = '#ff5fa2';
    ctx.fillText('HEAT', G.view.w / 2, 306);
    ctx.font = '17px system-ui, sans-serif';
    ctx.fillStyle = '#f2efe8';
    ctx.fillText('An open-world crime story in a city that never cools down.', G.view.w / 2, 344);
    const items = G.menuItems();
    items.forEach((item, i) => {
      const y = 428 + i * 52;
      const selected = G.menuIndex === i;
      ctx.font = selected ? 'bold 27px system-ui, sans-serif' : '22px system-ui, sans-serif';
      ctx.fillStyle = selected ? '#ffd76a' : 'rgba(240,240,240,0.75)';
      ctx.fillText(`${selected ? '▸ ' : ''}${item.label}`, G.view.w / 2, y);
    });
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('WASD drive & walk · E enter car / talk · F or click punch & shoot · Space handbrake · P pause · V save', G.view.w / 2, G.view.h - 30);
  }

  function drawPause(G, ctx) {
    ctx.fillStyle = 'rgba(8,10,16,0.72)';
    ctx.fillRect(0, 0, G.view.w, G.view.h);
    const w = 620, h = 470, x = G.view.w / 2 - w / 2, y = G.view.h / 2 - h / 2;
    ctx.fillStyle = 'rgba(16,22,32,0.97)';
    roundRect(ctx, x, y, w, h, 12); ctx.fill();
    ctx.strokeStyle = '#ffd76a';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, w, h, 12); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.fillStyle = '#ffd76a';
    ctx.fillText('PAUSED', G.view.w / 2, y + 48);
    const controls = [
      ['W A S D / Arrows', 'Walk & drive'],
      ['Shift', 'Run'],
      ['E', 'Enter / exit car · talk · advance dialogue'],
      ['F or Mouse click', 'Punch · shoot'],
      ['Mouse', 'Aim'],
      ['Space', 'Handbrake (drift)'],
      ['H', 'Horn'],
      ['V', 'Save now'],
      ['P or Esc', 'Resume'],
    ];
    ctx.font = '15px system-ui, sans-serif';
    controls.forEach(([key, what], i) => {
      const yy = y + 92 + i * 27;
      ctx.textAlign = 'right';
      ctx.fillStyle = '#9fd8ff';
      ctx.fillText(key, G.view.w / 2 - 14, yy);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#e8e4da';
      ctx.fillText(what, G.view.w / 2 + 14, yy);
    });
    const s = G.stats;
    ctx.textAlign = 'center';
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(
      `Jobs done ${s.jobsDone}/5 · Cars stolen ${s.stolen} · Taxi fares ${s.taxiFares} · Knockouts ${s.kos} · Earned $${s.earned.toLocaleString('en-US')}`,
      G.view.w / 2, y + h - 42,
    );
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(`Clock ${clockText(G.dayTime)} · ${World.districtAt(G.player.x, G.player.y)} · autosave on`, G.view.w / 2, y + h - 18);
  }

  function drawEndCard(G, ctx) {
    ctx.fillStyle = G.endCard.kind === 'busted' ? 'rgba(20,30,70,0.55)' : 'rgba(70,10,10,0.55)';
    ctx.fillRect(0, 0, G.view.w, G.view.h);
    ctx.textAlign = 'center';
    ctx.font = '900 84px system-ui, sans-serif';
    ctx.fillStyle = G.endCard.kind === 'busted' ? '#9fd8ff' : '#ff5f5f';
    ctx.fillText(G.endCard.kind === 'busted' ? 'BUSTED' : 'WASTED', G.view.w / 2, G.view.h / 2 - 10);
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillStyle = '#f2efe8';
    ctx.fillText(G.endCard.text, G.view.w / 2, G.view.h / 2 + 34);
  }

  // --- the frame ------------------------------------------------------------------
  function draw(G, ctx) {
    const view = G.view;
    const cam = G.camera;
    const sun = sunInfo(G.dayTime);
    ctx.fillStyle = '#20242c';
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.save();
    ctx.translate(-Math.round(cam.x), -Math.round(cam.y));
    const visible = { x: cam.x - 20, y: cam.y - 20, w: view.w + 40, h: view.h + 40 };
    drawGround(G, ctx, visible);
    for (const b of G.world.buildings) {
      if (b.x + b.w < visible.x || b.x > visible.x + visible.w || b.y + b.h < visible.y || b.y > visible.y + visible.h) continue;
      drawBuilding(G, ctx, b, sun);
    }
    drawProps(G, ctx, sun);
    drawPickupsAndMarkers(G, ctx);
    for (const ped of G.peds) drawPed(G, ctx, ped);
    for (const car of G.cars) drawCar(G, ctx, car, sun);
    drawPlayer(G, ctx);
    drawEffects(G, ctx);
    drawNight(G, ctx, visible, sun);
    ctx.restore();

    if (G.mode === 'title') { drawTitle(G, ctx); return; }
    drawMinimap(G, ctx);
    drawHUD(G, ctx);
    if (G.paused) drawPause(G, ctx);
    if (G.endCard) drawEndCard(G, ctx);
  }

  return { draw, sunInfo, clockText };
})();
