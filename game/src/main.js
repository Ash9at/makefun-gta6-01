// main.js — Solmaris Heat: state, input, the update loop, crime and cops.
//
// The state object G is the one shared thing: world.js builds the city,
// entities.js moves the cars and crowds, missions.js runs the work, and
// render.js draws all of it. This file owns the player, the police answer,
// combat, saving, the title screen, and the deterministic screenshot scenes
// (?shot=<name>&seed=<n>) the entry's screenshots are taken from.

const Game = (() => {
  const canvas = document.getElementById('view');
  const ctx = canvas.getContext('2d');

  const G = {
    view: { w: canvas.width, h: canvas.height },
    mode: 'title', paused: false, endCard: null, endTimer: 0,
    time: 0, dayTime: 0.40, heat: 0, minStars: 0, bust: 0,
    camera: { x: 0, y: 0 },
    world: null, rng: RNG.stream(1234),
    player: null, cars: [], peds: [], drops: [],
    particles: [], tracers: [], skids: [], floaters: [], toasts: [],
    job: null, taxi: null,
    rampage: { active: false, timeLeft: 0, points: 0, cooldown: 0 },
    stats: { jobsDone: 0, stolen: 0, taxiFares: 0, kos: 0, earned: 0 },
    dialogue: null, nextJobTimer: -1, autosaveTimer: 12,
    keys: new Set(), mouse: { x: 0, y: 0, down: false },
    menuIndex: 0, hasSave: false, crimeCooldown: 0,
  };

  // --- small services the other files call through G -------------------------
  G.toast = (text) => {
    G.toasts.push({ text, t: 4.2 });
    if (G.toasts.length > 3) G.toasts.shift();
  };
  G.floatText = (text, x, y, color) => G.floaters.push({ text, x, y, color, t: 1.2 });
  G.say = (speaker, lines) => { G.dialogue = { speaker, lines: [...lines], idx: 0, t: 0 }; };
  G.stars = () => Math.max(G.minStars, Math.min(5, Math.ceil(G.heat / CFG.HEAT.perStar)));
  G.addHeat = (amount) => {
    // Crime counts in full with witnesses about, half on an empty street.
    let witnessed = G.cars.some((c) => c.kind === 'police' && RNG.dist2(c.x, c.y, G.player.x, G.player.y) < 420 * 420);
    if (!witnessed) witnessed = G.peds.some((p) => p.state !== 'down' && RNG.dist2(p.x, p.y, G.player.x, G.player.y) < 300 * 300);
    G.heat = Math.min(150, G.heat + amount * (witnessed ? 1 : 0.5));
    G.crimeCooldown = 5;
  };
  G.objectiveTarget = () => {
    if (G.taxi) return G.taxi.dest;
    if (G.job && !G.job.done) return G.job.target;
    return null;
  };
  G.objectiveLabel = () => {
    if (G.taxi) return `Take your passenger to ${G.taxi.dest.name}`;
    if (G.job && !G.job.done && G.job.target) return G.job.target.label;
    if (G.job && G.job.done) return 'Free roam — taxi fares and the plaza rampage pay cash';
    return null;
  };
  G.menuItems = () => {
    const items = [{ id: 'new', label: 'NEW GAME' }];
    if (G.hasSave) items.push({ id: 'continue', label: 'CONTINUE' });
    return items;
  };

  // --- sound: tiny oscillator blips, created lazily on first input ------------
  let audioCtx = null;
  G.sfx = (name) => {
    try {
      if (typeof AudioContext === 'undefined') return;
      if (!audioCtx) audioCtx = new AudioContext();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const notes = {
        shot: [[160, 0.07, 'square', 0.05]],
        punch: [[90, 0.06, 'triangle', 0.08]],
        cash: [[880, 0.07, 'sine', 0.06], [1320, 0.1, 'sine', 0.06]],
        pickup: [[620, 0.06, 'sine', 0.05], [930, 0.08, 'sine', 0.05]],
        horn: [[370, 0.16, 'sawtooth', 0.04], [370, 0.16, 'sawtooth', 0.04]],
        crash: [[70, 0.18, 'sawtooth', 0.09]],
        bust: [[220, 0.3, 'square', 0.05]],
      }[name];
      if (!notes) return;
      let at = audioCtx.currentTime;
      for (const [freq, dur, type, vol] of notes) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(vol, at);
        gain.gain.exponentialRampToValueAtTime(0.001, at + dur);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(at);
        osc.stop(at + dur);
        at += dur * 0.8;
      }
    } catch (err) { /* sound is garnish; never let it break the game */ }
  };

  // --- saving -------------------------------------------------------------------
  function saveGame() {
    try {
      const p = G.player;
      const data = {
        v: 1, x: p.x, y: p.y, angle: p.angle, hp: p.hp,
        cash: p.cash, respect: p.respect, score: p.score,
        jobIndex: G.job ? G.job.index : G.stats.jobsDone,
        jobDone: G.job ? G.job.done : true,
        stats: G.stats, dayTime: G.dayTime,
      };
      localStorage.setItem(CFG.SAVE_KEY, JSON.stringify(data));
      G.hasSave = true;
    } catch (err) { /* private mode etc.: play on unsaved */ }
  }
  G.saveGame = saveGame;

  function readSave() {
    try {
      const raw = localStorage.getItem(CFG.SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) { return null; }
  }

  // --- world and cast -------------------------------------------------------------
  function freshPlayer(x, y) {
    return {
      x, y, angle: -Math.PI / 2, hp: 100, cash: 120, respect: 0, score: 0,
      car: null, speedNow: 0, punchT: 0, punchCd: 0, shootCd: 0, hurtT: 0,
    };
  }

  function buildWorld(seed) {
    G.world = World.build(seed);
    World.current = G.world;
    G.cars = [];
    G.peds = [];
    G.drops = [];
    const rng = G.rng;
    // Parked cars from the world's spots (a sample, so streets stay passable).
    for (const spot of G.world.parkedSpots) {
      if (rng.chance(0.62)) G.cars.push(Ent.makeCar(spot.x, spot.y, spot.angle + rng.range(-0.06, 0.06), 'parked', rng));
    }
    // Traffic already circulating.
    for (let n = 0; n < 14; n++) {
      const i = rng.int(0, CFG.COLS), j = rng.int(0, CFG.ROWS);
      const car = Ent.makeCar(World.streetCX(i) + rng.range(-14, 14), World.streetCY(j) + rng.range(-14, 14), rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]), 'traffic', rng);
      car.driver = Ent.makePed(car.x, car.y, rng);
      G.cars.push(car);
    }
    // The crowd.
    for (let n = 0; n < 42; n++) {
      const ped = Ent.makePed(rng.range(60, CFG.WORLD_W - 60), rng.range(60, CFG.CITY_H - 40), rng);
      if (World.isWater(ped.x, ped.y)) ped.y = CFG.BEACH_Y + 40;
      G.peds.push(ped);
    }
  }

  function startNewGame() {
    buildWorld(7);
    G.player = freshPlayer(World.streetCX(3), CFG.CITY_H - 150);
    G.heat = 0; G.minStars = 0; G.bust = 0;
    G.stats = { jobsDone: 0, stolen: 0, taxiFares: 0, kos: 0, earned: 0 };
    G.job = null; G.taxi = null;
    G.mode = 'play';
    Mis.startJob(G, 0);
    saveGame();
  }

  function startContinue() {
    const data = readSave();
    buildWorld(7);
    G.player = freshPlayer(World.streetCX(3), CFG.CITY_H - 150);
    G.mode = 'play';
    if (!data) { Mis.startJob(G, 0); return; }
    const p = G.player;
    p.x = data.x; p.y = data.y; p.angle = data.angle; p.hp = data.hp ?? 100;
    p.cash = data.cash; p.respect = data.respect; p.score = data.score;
    G.stats = data.stats;
    G.dayTime = data.dayTime ?? 0.4;
    const idx = Math.min(data.jobIndex ?? 0, Mis.JOBS.length - 1);
    if (data.jobDone && data.jobIndex >= Mis.JOBS.length - 1 && G.stats.jobsDone >= Mis.JOBS.length) {
      G.job = null;
      G.toast('Welcome back. Solmaris is yours — free roam.');
    } else if (data.jobDone) {
      Mis.startJob(G, Math.min(idx + 1, Mis.JOBS.length - 1));
    } else {
      Mis.startJob(G, idx);
    }
  }

  // --- input ----------------------------------------------------------------------
  const KEYMAP = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyF', 'KeyH', 'KeyP', 'Escape'];
  function pressKey(code, down) {
    if (down) G.keys.add(code); else G.keys.delete(code);
    if (down) onKeyPress(code);
  }
  function keyHeld(...codes) { return codes.some((c) => G.keys.has(c)); }

  function onKeyPress(code) {
    if (G.mode === 'title') {
      if (code === 'ArrowUp' || code === 'KeyW') G.menuIndex = Math.max(0, G.menuIndex - 1);
      if (code === 'ArrowDown' || code === 'KeyS') G.menuIndex = Math.min(G.menuItems().length - 1, G.menuIndex + 1);
      if (code === 'Enter' || code === 'Space') {
        const item = G.menuItems()[G.menuIndex];
        if (item.id === 'new') startNewGame();
        else startContinue();
      }
      return;
    }
    if (code === 'KeyP' || code === 'Escape') { if (!G.endCard) G.paused = !G.paused; return; }
    if (G.paused || G.endCard) return;
    if (code === 'KeyE') interact();
    if (code === 'KeyV') { saveGame(); G.toast('Saved'); }
    if (code === 'KeyH' && G.player.car) { G.sfx('horn'); scarePeds(G.player.x, G.player.y, 120); }
    if (code === 'KeyF') attack();
  }

  function mouseWorld() {
    return { x: G.mouse.x + G.camera.x, y: G.mouse.y + G.camera.y };
  }

  // --- the E key: dialogue first, then cars, then the world -------------------------
  function interact() {
    if (G.dialogue) {
      const d = G.dialogue;
      d.idx += 1;
      if (d.idx >= d.lines.length) G.dialogue = null;
      return;
    }
    const p = G.player;
    if (p.car) {
      // Step out beside the car.
      const car = p.car;
      p.x = car.x + Math.cos(car.angle - Math.PI / 2) * 30;
      p.y = car.y + Math.sin(car.angle - Math.PI / 2) * 30;
      p.car = null;
      car.driver = null;
      // A car you step out of stays where you left it (unless it is Marisol's).
      if (car.kind !== 'mission') { car.kind = 'parked'; car.route = null; }
      car.speed = 0;
      return;
    }
    // Nearest car you could take.
    let best = null, bestD = 46 * 46;
    for (const car of G.cars) {
      if (car.wreck) continue;
      const d = RNG.dist2(p.x, p.y, car.x, car.y);
      if (d < bestD) { bestD = d; best = car; }
    }
    if (best) {
      if (best.driver && best.kind === 'traffic') {
        // Carjack: the driver is pulled out and runs.
        const driver = best.driver;
        driver.x = best.x - 26; driver.y = best.y + 18;
        driver.state = 'flee'; driver.fleeFrom = { x: p.x, y: p.y };
        G.peds.push(driver);
        best.driver = null;
        G.addHeat(CFG.HEAT.carjack);
        G.stats.stolen += 1;
        G.toast('Carjacked!');
      } else if (best.kind === 'parked' || best.kind === 'mission') {
        G.addHeat(CFG.HEAT.steal);
        G.stats.stolen += 1;
      }
      best.kind = best.kind === 'mission' ? 'mission' : 'traffic';
      best.route = null;
      p.car = best;
      best.driver = p;
      G.sfx('pickup');
    }
  }

  function scarePeds(x, y, radius) {
    for (const ped of G.peds) {
      if (ped.state === 'walk' && RNG.dist2(x, y, ped.x, ped.y) < radius * radius) {
        ped.state = 'flee';
        ped.fleeFrom = { x, y };
      }
    }
  }

  // --- combat -------------------------------------------------------------------------
  function koPed(ped, byPlayer) {
    if (ped.state === 'down') return;
    ped.state = 'down';
    ped.downTimer = 16;
    if (byPlayer) {
      G.stats.kos += 1;
      G.drops.push({ x: ped.x + G.rng.range(-8, 8), y: ped.y + G.rng.range(-8, 8), amount: ped.cash });
      Mis.rampageScore(G, 'ko');
      scarePeds(ped.x, ped.y, 130);
    }
  }

  function attack() {
    const p = G.player;
    if (p.car || p.punchCd > 0) return;
    const mw = mouseWorld();
    p.angle = Math.atan2(mw.y - p.y, mw.x - p.x);
    p.punchT = 0.22;
    p.punchCd = 0.34;
    // A punch lands on anything close in the facing arc; otherwise it is a shot.
    let punched = false;
    for (const ped of G.peds) {
      if (ped.state === 'down' || ped.state === 'ride') continue;
      const d = RNG.dist(p.x, p.y, ped.x, ped.y);
      if (d < CFG.FOOT.punchRange && Math.abs(RNG.angleDelta(p.angle, Math.atan2(ped.y - p.y, ped.x - p.x))) < CFG.FOOT.punchArc) {
        ped.hp -= 30;
        punched = true;
        G.sfx('punch');
        if (ped.hp <= 0) { koPed(ped, true); G.addHeat(CFG.HEAT.koPed); }
        else { ped.state = 'flee'; ped.fleeFrom = { x: p.x, y: p.y }; }
      }
    }
    if (!punched) shoot();
  }

  function shoot() {
    const p = G.player;
    if (p.shootCd > 0) return;
    p.shootCd = 0.21;
    G.sfx('shot');
    const from = p.car ? { x: p.car.x, y: p.car.y } : { x: p.x, y: p.y };
    const mw = mouseWorld();
    const angle = Math.atan2(mw.y - from.y, mw.x - from.x);
    if (!p.car) p.angle = angle;
    const range = 340;
    let hitT = 1, hitPed = null, hitCar = null;
    const test = (x, y, r, obj, isPed) => {
      const dx = x - from.x, dy = y - from.y;
      const t = dx * Math.cos(angle) + dy * Math.sin(angle);
      if (t < 0 || t > range) return;
      const perp = Math.abs(-dx * Math.sin(angle) + dy * Math.cos(angle));
      if (perp < r && t / range < hitT) { hitT = t / range; if (isPed) { hitPed = obj; hitCar = null; } else { hitCar = obj; hitPed = null; } }
    };
    for (const ped of G.peds) if (ped.state !== 'down' && ped.state !== 'ride') test(ped.x, ped.y, 11, ped, true);
    for (const car of G.cars) if (car !== p.car) test(car.x, car.y, 20, car, false);
    const endX = from.x + Math.cos(angle) * range * hitT;
    const endY = from.y + Math.sin(angle) * range * hitT;
    G.tracers.push({ x1: from.x, y1: from.y, x2: endX, y2: endY, t: 0.14 });
    G.particles.push({ x: from.x + Math.cos(angle) * 16, y: from.y + Math.sin(angle) * 16, vx: 0, vy: 0, t: 0.07, life: 0.07, color: '#ffd76a', size: 5 });
    G.addHeat(CFG.HEAT.shot);
    scarePeds(from.x, from.y, 170);
    if (hitPed) {
      hitPed.hp -= 34;
      if (hitPed.hp <= 0) { koPed(hitPed, true); G.addHeat(CFG.HEAT.koPed); }
      else { hitPed.state = 'flee'; hitPed.fleeFrom = { x: from.x, y: from.y }; }
    } else if (hitCar) {
      damageCar(hitCar, 11, true);
    }
  }

  function damageCar(car, amount, byPlayer) {
    if (car.wreck) return;
    car.health -= amount;
    if (car.health <= 0) {
      car.health = 0;
      car.wreck = true;
      G.particles.push({ x: car.x, y: car.y, vx: 0, vy: -12, t: 1.4, life: 1.4, color: 'rgba(255,120,40,0.8)', size: 13 });
      G.sfx('crash');
      if (byPlayer) {
        G.addHeat(CFG.HEAT.destroyCar);
        Mis.rampageScore(G, 'wreck');
        if (car.driver && car.driver !== G.player) {
          const d = car.driver;
          d.x = car.x + 26; d.y = car.y;
          d.state = 'flee'; d.fleeFrom = { x: G.player.x, y: G.player.y };
          G.peds.push(d);
          car.driver = null;
        }
        if (G.player.car === car) { /* you are in it: you climb out in interact's wreck check */ }
      }
    }
  }

  // --- consequences ---------------------------------------------------------------------
  function doBusted() {
    const p = G.player;
    G.sfx('bust');
    const fine = Math.max(50, Math.round(p.cash * 0.12));
    p.cash = Math.max(0, p.cash - fine);
    G.endCard = { kind: 'busted', text: `The Solmaris Police relieve you of $${fine} and your afternoon.` };
    G.endTimer = 2.8;
  }

  function doWasted() {
    const p = G.player;
    const fee = Math.min(100, p.cash);
    p.cash -= fee;
    G.endCard = { kind: 'wasted', text: `Hospital del Mar patches you up. Bill: $${fee}.` };
    G.endTimer = 2.8;
  }

  function respawn() {
    const p = G.player;
    const spot = G.endCard.kind === 'busted'
      ? { x: G.world.station.x + G.world.station.w / 2, y: G.world.station.y + G.world.station.h + 24 }
      : { x: G.world.hospital.x + G.world.hospital.w / 2, y: G.world.hospital.y + G.world.hospital.h + 24 };
    if (p.car) { p.car.driver = null; p.car = null; }
    p.x = spot.x; p.y = spot.y;
    p.hp = G.endCard.kind === 'busted' ? 80 : 100;
    G.heat = G.endCard.kind === 'busted' ? 0 : G.heat * 0.35;
    if (G.endCard.kind === 'busted') G.minStars = 0;
    G.bust = 0;
    G.endCard = null;
    saveGame();
  }

  function spawnPolice() {
    // Come from a junction a few streets away, never from thin air beside you.
    const p = G.player;
    for (let tries = 0; tries < 8; tries++) {
      const i = G.rng.int(0, CFG.COLS), j = G.rng.int(0, CFG.ROWS);
      const x = World.streetCX(i), y = World.streetCY(j);
      const d = RNG.dist(x, y, p.x, p.y);
      if (d > 430 && d < 900) {
        const car = Ent.makeCar(x, y, 0, 'police', G.rng);
        car.shootCd = G.rng.range(0.4, 1.4);
        G.cars.push(car);
        return;
      }
    }
  }

  // --- per-frame update ---------------------------------------------------------------------
  function updatePlayer(dt) {
    const p = G.player;
    p.punchCd = Math.max(0, p.punchCd - dt);
    p.shootCd = Math.max(0, p.shootCd - dt);
    p.punchT = Math.max(0, p.punchT - dt);
    p.hurtT += dt;
    if (p.hurtT > 7 && p.hp > 0) p.hp = Math.min(100, p.hp + 2.4 * dt);
    if (G.mouse.down && !G.paused) {
      if (p.car) shoot();
      else attack();
    }

    if (p.car) {
      const car = p.car;
      if (car.wreck) {
        p.x = car.x + 30; p.y = car.y;
        car.driver = null;
        p.car = null;
        G.toast('The car is wrecked — out!');
        return;
      }
      const control = G.scriptControl || {
        throttle: (keyHeld('KeyW', 'ArrowUp') ? 1 : 0) + (keyHeld('KeyS', 'ArrowDown') ? -1 : 0),
        steer: (keyHeld('KeyA', 'ArrowLeft') ? -1 : 0) + (keyHeld('KeyD', 'ArrowRight') ? 1 : 0),
        handbrake: keyHeld('Space'),
      };
      const before = { x: car.x, y: car.y, speed: car.speed };
      Ent.stepCar(car, control, dt);
      collideCarWithWorld(car, before);
      p.x = car.x; p.y = car.y; p.angle = car.angle;
      p.speedNow = Math.abs(car.speed);
      // Skid marks while drifting or spinning the wheels.
      if ((Math.abs(car.slip) > 0.16 && Math.abs(car.speed) > 130) || (control.handbrake && Math.abs(car.speed) > 60)) {
        const bx = car.x - Math.cos(car.angle) * 14, by = car.y - Math.sin(car.angle) * 14;
        const px = bx + Math.cos(car.angle + Math.PI / 2) * 8, py = by + Math.sin(car.angle + Math.PI / 2) * 8;
        const qx = bx - Math.cos(car.angle + Math.PI / 2) * 8, qy = by - Math.sin(car.angle + Math.PI / 2) * 8;
        if (car._skid) {
          G.skids.push({ x1: car._skid[0], y1: car._skid[1], x2: px, y2: py, t: 1 });
          G.skids.push({ x1: car._skid[2], y1: car._skid[3], x2: qx, y2: qy, t: 1 });
          if (G.skids.length > 340) G.skids.splice(0, G.skids.length - 340);
        }
        car._skid = [px, py, qx, qy];
      } else car._skid = null;
      return;
    }

    // On foot.
    let mx = (keyHeld('KeyD', 'ArrowRight') ? 1 : 0) - (keyHeld('KeyA', 'ArrowLeft') ? 1 : 0);
    let my = (keyHeld('KeyS', 'ArrowDown') ? 1 : 0) - (keyHeld('KeyW', 'ArrowUp') ? 1 : 0);
    if (G.scriptControl) { mx = G.scriptControl.mx || 0; my = G.scriptControl.my || 0; }
    const moving = mx !== 0 || my !== 0;
    const running = keyHeld('ShiftLeft', 'ShiftRight');
    const speed = running ? CFG.FOOT.run : CFG.FOOT.walk;
    if (moving) {
      const len = Math.hypot(mx, my);
      p.angle = Math.atan2(my, mx);
      p.x += (mx / len) * speed * dt;
      p.y += (my / len) * speed * dt;
      p.speedNow = speed;
    } else p.speedNow = 0;
    if (G.mouse.down) {
      const mw = mouseWorld();
      p.angle = Math.atan2(mw.y - p.y, mw.x - p.x);
    }
    const push = World.collideCircle(p.x, p.y, CFG.FOOT.radius);
    if (push) { p.x += push.dx; p.y += push.dy; }
    if (World.isWater(p.x, p.y)) { p.y = CFG.WATER_Y - 14; p.speedNow = 0; }
    p.x = RNG.clamp(p.x, 12, CFG.WORLD_W - 12);
    p.y = RNG.clamp(p.y, 12, CFG.WORLD_H - 12);
  }

  function collideCarWithWorld(car, before) {
    const push = World.collideCircle(car.x, car.y, CFG.CAR.radius);
    if (push) {
      car.x += push.dx;
      car.y += push.dy;
      const impact = Math.abs(car.speed);
      if (impact > 190) {
        damageCar(car, (impact - 180) * 0.09, car === G.player.car);
        G.sfx('crash');
        if (car === G.player.car) { G.addHeat(CFG.HEAT.hitCar); Mis.rampageScore(G, 'hit'); }
      }
      car.speed *= 0.45;
    }
    if (World.isWater(car.x, car.y) && car.speed !== 0) {
      // Cars that reach the sea are done: heavy drag, fast rust.
      car.speed *= Math.pow(0.2, 1 / 60);
      damageCar(car, 4, false);
    }
  }

  function updateCars(dt) {
    const p = G.player;
    for (const car of G.cars) {
      if (car === p.car) continue;
      const before = { x: car.x, y: car.y, speed: car.speed };
      if (car.kind === 'traffic' && !car.wreck) {
        Ent.stepCar(car, Ent.driveTraffic(G, car, dt), dt);
        collideCarWithWorld(car, before);
      } else if (car.kind === 'police') {
        Ent.stepCar(car, Ent.drivePolice(G, car, dt), dt);
        collideCarWithWorld(car, before);
        // Police fire once the chase is hot and they have range.
        if (G.stars() >= 3 && !car.wreck) {
          car.shootCd -= dt;
          const d = RNG.dist(car.x, car.y, p.x, p.y);
          if (car.shootCd <= 0 && d < 260) {
            car.shootCd = G.rng.range(0.7, 1.3);
            G.tracers.push({ x1: car.x, y1: car.y, x2: p.x, y2: p.y, t: 0.12 });
            if (G.rng.chance(0.55)) {
              if (p.car) { damageCar(p.car, 3, false); p.hp -= 1; }
              else p.hp -= G.rng.range(3.5, 7);
              p.hurtT = 0;
            }
          }
        }
      } else if (car.wreck || car.kind === 'parked' || car.kind === 'mission') {
        if (Math.abs(car.speed) > 1) { Ent.stepCar(car, { throttle: 0, steer: 0, handbrake: true }, dt); }
      }
    }
    // Car-to-car bumps.
    for (let i = 0; i < G.cars.length; i++) {
      for (let j = i + 1; j < G.cars.length; j++) {
        const a = G.cars[i], b = G.cars[j];
        const d2 = RNG.dist2(a.x, a.y, b.x, b.y);
        if (d2 < 36 * 36 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const push = (36 - d) / 2;
          const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d;
          if (a !== p.car) { a.x -= nx * push; a.y -= ny * push; }
          if (b !== p.car) { b.x += nx * push; b.y += ny * push; }
          const rel = Math.abs(a.speed - b.speed);
          if (rel > 120) {
            damageCar(a, rel * 0.05, b === p.car);
            damageCar(b, rel * 0.05, a === p.car);
            if (a === p.car || b === p.car) { G.addHeat(CFG.HEAT.hitCar); Mis.rampageScore(G, 'hit'); G.sfx('crash'); }
          }
          a.speed *= 0.7; b.speed *= 0.7;
        }
      }
    }
    // Cars versus pedestrians: fast metal wins, and it is a crime.
    for (const car of G.cars) {
      if (Math.abs(car.speed) < 110) continue;
      for (const ped of G.peds) {
        if (ped.state === 'down' || ped.state === 'ride') continue;
        if (RNG.dist2(car.x, car.y, ped.x, ped.y) < 21 * 21) {
          koPed(ped, car === p.car);
          if (car === p.car) G.addHeat(CFG.HEAT.koPed);
          ped.x += Math.cos(car.angle) * 20;
          ped.y += Math.sin(car.angle) * 20;
        }
      }
    }
    // Despawn police who lost the trail far away when the heat is off.
    if (G.stars() === 0) {
      for (let i = G.cars.length - 1; i >= 0; i--) {
        if (G.cars[i].kind === 'police' && RNG.dist2(G.cars[i].x, G.cars[i].y, p.x, p.y) > 500 * 500) G.cars.splice(i, 1);
      }
    }
  }

  function updatePeds(dt) {
    const p = G.player;
    for (const ped of G.peds) {
      Ent.stepPed(G, ped, dt);
      if (ped.state === 'walk') {
        ped.hailCooldown -= dt;
        // Now and then a pedestrian wants a cab — if you are the cab.
        if (!G.taxi && ped.hailCooldown <= 0 && G.rng.chance(dt * 0.05)) {
          ped.state = 'hail';
          ped.hailTimer = 13;
        }
      } else if (ped.state === 'hail') {
        ped.hailTimer -= dt;
        if (ped.hailTimer <= 0) { ped.state = 'walk'; ped.hailCooldown = G.rng.range(30, 80); }
        else if (p.car && !G.taxi && RNG.dist(p.x, p.y, ped.x, ped.y) < 50 && Math.abs(p.car.speed) < 42) {
          // Board: the pedestrian leaves the street and rides with you.
          G.peds.splice(G.peds.indexOf(ped), 1);
          p.car.passenger = ped;
          Mis.startFare(G, ped);
        }
      }
    }
    // Cash drops drift to your pocket.
    for (let i = G.drops.length - 1; i >= 0; i--) {
      const drop = G.drops[i];
      if (RNG.dist(p.x, p.y, drop.x, drop.y) < 24) {
        p.cash += drop.amount;
        p.score += drop.amount;
        G.floatText(`+$${drop.amount}`, drop.x, drop.y - 14, '#7ddc7d');
        G.sfx('cash');
        G.drops.splice(i, 1);
      }
    }
  }

  function updatePolice(dt) {
    const stars = G.stars();
    const p = G.player;
    G.policeTimer = (G.policeTimer ?? 2) - dt;
    const want = stars === 0 ? 0 : Math.min(stars + 1, 6);
    const have = G.cars.filter((c) => c.kind === 'police').length;
    if (have < want && G.policeTimer <= 0) {
      spawnPolice();
      G.policeTimer = 1.6;
    }
    // The bust clock: pinned by a nearby unit while you are slow.
    let pinned = false;
    if (stars > 0) {
      for (const car of G.cars) {
        if (car.kind === 'police' && !car.wreck && RNG.dist(car.x, car.y, p.x, p.y) < 66 && p.speedNow < 46) pinned = true;
      }
    }
    G.bust = RNG.clamp(G.bust + (pinned ? dt / 2.4 : -dt * 1.3), 0, 1);
    if (G.bust >= 1) doBusted();
    // Heat cools when you stop making noise; slower with eyes on you.
    G.crimeCooldown -= dt;
    if (G.crimeCooldown <= 0 && G.heat > 0) {
      const seen = G.cars.some((c) => c.kind === 'police' && RNG.dist2(c.x, c.y, p.x, p.y) < 380 * 380);
      G.heat = Math.max(0, G.heat - (seen ? CFG.HEAT.decaySeen : CFG.HEAT.decay) * dt);
    }
  }

  function updateFx(dt) {
    for (const list of [G.particles, G.floaters]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const pt = list[i];
        pt.t -= dt;
        if (pt.vx !== undefined) { pt.x += pt.vx * dt; pt.y += pt.vy * dt; }
        if (list === G.floaters) pt.y -= 26 * dt;
        if (pt.t <= 0) list.splice(i, 1);
      }
    }
    for (let i = G.tracers.length - 1; i >= 0; i--) { G.tracers[i].t -= dt; if (G.tracers[i].t <= 0) G.tracers.splice(i, 1); }
    for (let i = G.skids.length - 1; i >= 0; i--) { G.skids[i].t -= dt * 0.05; if (G.skids[i].t <= 0) G.skids.splice(i, 1); }
    for (let i = G.toasts.length - 1; i >= 0; i--) { G.toasts[i].t -= dt; if (G.toasts[i].t <= 0) G.toasts.splice(i, 1); }
    if (G.dialogue) {
      G.dialogue.t += dt;
      if (G.dialogue.t > 9) {
        G.dialogue.idx += 1;
        G.dialogue.t = 0;
        if (G.dialogue.idx >= G.dialogue.lines.length) G.dialogue = null;
      }
    }
  }

  function update(dt) {
    G.time += dt;
    if (G.mode === 'title') {
      // A slow aerial drift over the marina while the menu waits.
      const cx = CFG.WORLD_W / 2 + Math.cos(G.time * 0.045) * 420 - G.view.w / 2;
      const cy = 1500 + Math.sin(G.time * 0.03) * 320 - G.view.h / 2;
      G.camera.x = RNG.clamp(cx, 0, CFG.WORLD_W - G.view.w);
      G.camera.y = RNG.clamp(cy, 0, CFG.WORLD_H - G.view.h);
      updateFx(dt);
      return;
    }
    if (G.endCard) {
      G.endTimer -= dt;
      updateFx(dt);
      if (G.endTimer <= 0) respawn();
      return;
    }
    if (G.paused) return;

    G.dayTime = (G.dayTime + dt / CFG.DAY_LENGTH) % 1;
    updatePlayer(dt);
    updateCars(dt);
    updatePeds(dt);
    updatePolice(dt);
    Mis.updateJob(G, dt);
    Mis.updateTaxi(G, dt);
    Mis.updateRampage(G, dt);
    updateFx(dt);

    // The chain: a finished job rings the next one in a few seconds later.
    if (G.job && G.job.done && G.nextJobTimer < 0) {
      G.nextJobTimer = 5;
      saveGame();
    }
    if (G.nextJobTimer > 0) {
      G.nextJobTimer -= dt;
      if (G.nextJobTimer <= 0) {
        G.nextJobTimer = -1;
        if (G.job && G.job.index + 1 < Mis.JOBS.length) Mis.startJob(G, G.job.index + 1);
        else if (G.job) {
          G.job = null;
          G.toast('Story complete — Solmaris is yours. Fares and rampages still pay.');
          saveGame();
        }
      }
    }
    if (G.player.hp <= 0) doWasted();

    // Autosave quietly.
    G.autosaveTimer -= dt;
    if (G.autosaveTimer <= 0) { G.autosaveTimer = 15; saveGame(); }

    // Camera: on the player, leaning into motion.
    const p = G.player;
    const lead = p.car ? 0.35 : 0.15;
    const tx = p.x + Math.cos(p.angle) * p.speedNow * lead - G.view.w / 2;
    const ty = p.y + Math.sin(p.angle) * p.speedNow * lead - G.view.h / 2;
    G.camera.x += (RNG.clamp(tx, 0, CFG.WORLD_W - G.view.w) - G.camera.x) * Math.min(1, dt * 5);
    G.camera.y += (RNG.clamp(ty, 0, CFG.WORLD_H - G.view.h) - G.camera.y) * Math.min(1, dt * 5);
  }

  // --- screenshot scenes -------------------------------------------------------------
  // Deterministic set-ups used to take the entry's screenshots: build the
  // seeded city, place the cast, run fixed steps, draw one frame.
  function placePlayerCar(x, y, angle, speed) {
    const car = Ent.makeCar(x, y, angle, 'traffic', G.rng);
    car.color = '#c33b2e';
    car.speed = speed;
    G.cars.push(car);
    G.player.car = car;
    car.driver = G.player;
    G.player.x = x; G.player.y = y; G.player.angle = angle;
    return car;
  }
  function placePolice(x, y, angle, speed) {
    const car = Ent.makeCar(x, y, angle, 'police', G.rng);
    car.speed = speed;
    car.shootCd = 99;
    G.cars.push(car);
    return car;
  }

  function setupShot(name, seed) {
    buildWorld(seed);
    G.player = freshPlayer(0, 0);
    G.mode = 'play';
    G.policeTimer = 9999;
    const S = CFG;
    if (name === 'cover') {
      G.dayTime = 0.795;
      Mis.startJob(G, 0);
      G.dialogue = null;
      const x = World.streetCX(5), y = World.streetCY(2);
      placePlayerCar(x, y, 0, 300);
      placePolice(x - 120, y - 42, 0, 320);
      placePolice(x - 210, y + 36, 0, 335);
      G.heat = 65;
      G.scriptControl = { throttle: 0.75, steer: 0.05, handbrake: false };
    } else if (name === 'foot') {
      G.dayTime = 0.44;
      Mis.startJob(G, 0);
      const shop = G.world.shops[3] || G.world.shops[0];
      G.player.x = shop.x + 30; G.player.y = shop.y + 26;
      G.player.angle = -0.5;
      for (let n = 0; n < 6; n++) {
        const ped = G.peds[n];
        ped.x = G.player.x + G.rng.range(-130, 150);
        ped.y = G.player.y + G.rng.range(-70, 80);
        ped.state = 'walk';
        ped.target = { x: ped.x + 60, y: ped.y };
      }
      const hail = G.peds[7];
      hail.x = G.player.x + 95; hail.y = G.player.y + 34;
      hail.state = 'hail'; hail.hailTimer = 99;
    } else if (name === 'chase') {
      G.dayTime = 0.965;
      const x = World.streetCX(6), y = World.streetCY(4);
      placePlayerCar(x, y, Math.PI, 385);
      placePolice(x + 110, y - 40, Math.PI, 390);
      placePolice(x + 200, y + 44, Math.PI, 395);
      placePolice(x + 60, y - 120, Math.PI * 0.9, 380);
      placePolice(x - 150, y + 90, Math.PI * 1.05, 370);
      G.heat = 150;
      G.scriptControl = { throttle: 0.85, steer: -0.04, handbrake: false };
    } else if (name === 'pier') {
      G.dayTime = 0.815;
      Mis.startJob(G, 4);
      G.dialogue = null;
      G.minStars = 0;
      G.job.timer = 150;
      G.player.x = G.world.pier.x + G.world.pier.w / 2;
      G.player.y = G.world.pier.y + 300;
      G.player.angle = Math.PI / 2;
      G.policeTimer = 9999;
    }
    for (let step = 0; step < 36; step++) update(1 / 30);
    G.scriptControl = null;
    if (name === 'chase') {
      const p = G.player;
      G.tracers.push({ x1: p.x + 130, y1: p.y - 40, x2: p.x + 8, y2: p.y - 4, t: 0.14 });
      G.tracers.push({ x1: p.x + 205, y1: p.y + 44, x2: p.x + 12, y2: p.y + 6, t: 0.14 });
    }
    // Settle the camera exactly on the player for the still.
    G.camera.x = RNG.clamp(G.player.x - G.view.w / 2, 0, CFG.WORLD_W - G.view.w);
    G.camera.y = RNG.clamp(G.player.y - G.view.h / 2, 0, CFG.WORLD_H - G.view.h);
    Ren.draw(G, ctx);
  }

  // --- boot and the browser loop ---------------------------------------------------------
  function frame(now) {
    const dt = Math.min(0.05, (now - (frame.last || now)) / 1000);
    frame.last = now;
    update(dt);
    Ren.draw(G, ctx);
    requestAnimationFrame(frame);
  }

  function bindInput() {
    window.addEventListener('keydown', (e) => {
      if (KEYMAP.includes(e.code) || e.code === 'Enter') e.preventDefault();
      if (!e.repeat) pressKey(e.code, true);
      else G.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => pressKey(e.code, false));
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      G.mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);
      G.mouse.y = (e.clientY - rect.top) * (canvas.height / rect.height);
    });
    canvas.addEventListener('mousedown', () => {
      G.mouse.down = true;
      if (G.mode === 'title') onKeyPress('Enter');
    });
    window.addEventListener('mouseup', () => { G.mouse.down = false; });
  }

  function boot() {
    G.hasSave = !!readSave();
    buildWorld(7);
    G.player = freshPlayer(World.streetCX(4), 1500);
    const params = new URLSearchParams(location.search);
    if (params.has('shot')) {
      setupShot(params.get('shot'), Number(params.get('seed') || 7));
      window.__shotDone = true;
      return;
    }
    bindInput();
    requestAnimationFrame(frame);
  }

  // A small handle for headless playtests and screenshot harnesses.
  window.Solmaris = { G, startNewGame, startContinue, pressKey, update, saveGame, setupShot, draw: () => Ren.draw(G, ctx) };

  boot();
  return { G };
})();
