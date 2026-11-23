// entities.js — cars and pedestrians: factories, physics, and the drivers.
//
// Cars are steered by a control triple {throttle, steer, handbrake}. The
// player produces one from the keyboard; traffic produces one by following
// the street grid from junction to junction; police produce one the same way
// until they are close enough to chase the player directly. Steering works
// on the car's velocity direction, with a slip angle that grows under the
// handbrake — that is the whole drift model, and it is enough to feel right.

const Ent = (() => {
  const { clamp, angleDelta, dist } = RNG;

  function makeCar(x, y, angle, kind, rng) {
    return {
      x, y, angle, speed: 0, slip: 0,
      kind, // 'parked' | 'traffic' | 'police' | 'mission'
      color: kind === 'police' ? '#e8ecf2' : rng.pick(CFG.CAR_COLORS),
      health: 100, wreck: false, smoke: 0,
      driver: null, passenger: null,
      route: null, stuckTimer: 0, honkTimer: 0,
      id: Math.floor(rng.range(1, 1e9)),
    };
  }

  function makePed(x, y, rng) {
    return {
      x, y, angle: rng.range(0, Math.PI * 2), speed: 0,
      state: 'walk', // walk | flee | down | hail | ride
      hp: 30, target: null, waitTimer: rng.range(0, 3),
      color: rng.pick(CFG.PED_COLORS), skin: rng.pick(['#f2c79b', '#c98d5e', '#8a5a34', '#6e4423']),
      fleeFrom: null, downTimer: 0, hailCooldown: rng.range(20, 90),
      cash: rng.int(4, 38), id: Math.floor(rng.range(1, 1e9)),
    };
  }

  // --- car physics -------------------------------------------------------
  // control: {throttle -1..1, steer -1..1, handbrake bool}
  function stepCar(car, rawControl, dt) {
    let control = rawControl;
    // Stuck recovery: full throttle and no motion means a wall is in the
    // way. Back out on full lock for half a second, then try again — this
    // keeps AI drivers from grinding along a facade forever.
    if (!car.wreck) {
      if (control.throttle > 0.4 && Math.abs(car.speed) < 14) car.stuckTimer += dt;
      else car.stuckTimer = Math.max(0, car.stuckTimer - dt * 2);
      if (car.stuckTimer > 0.75) { car.recoverTimer = 0.55; car.stuckTimer = 0; }
      if (car.recoverTimer > 0) {
        car.recoverTimer -= dt;
        control = { throttle: -1, steer: control.steer === 0 ? 1 : -control.steer, handbrake: false };
      }
    }
    if (car.wreck) {
      car.speed *= Math.pow(0.4, dt);
      car.x += Math.cos(car.angle + car.slip) * car.speed * dt;
      car.y += Math.sin(car.angle + car.slip) * car.speed * dt;
      return;
    }
    const C = CFG.CAR;
    if (control.throttle > 0) {
      car.speed += C.accel * control.throttle * dt;
    } else if (control.throttle < 0) {
      // Negative throttle brakes from speed, then reverses from a crawl.
      if (car.speed > 10) car.speed -= C.brake * dt;
      else car.speed += C.reverse * control.throttle * dt;
    }
    // Rolling drag and a soft top speed.
    car.speed -= car.speed * 0.55 * dt;
    if (!control.handbrake) car.speed -= Math.sign(car.speed) * 14 * dt * (Math.abs(car.speed) > 14 ? 1 : 0);
    car.speed = clamp(car.speed, -C.maxReverse, C.maxSpeed);

    const speedRatio = clamp(car.speed / C.maxSpeed, -1, 1);
    const grip = control.handbrake ? C.driftGrip : C.grip;
    const targetSlip = control.handbrake ? control.steer * 0.55 * Math.sign(car.speed) : control.steer * 0.06;
    car.slip += (targetSlip - car.slip) * Math.min(1, grip * dt);
    if (Math.abs(car.speed) > 4) {
      car.angle += control.steer * C.turnRate * speedRatio * dt * (control.handbrake ? 1.25 : 1);
    }
    const vx = Math.cos(car.angle + car.slip) * car.speed;
    const vy = Math.sin(car.angle + car.slip) * car.speed;
    car.x += vx * dt;
    car.y += vy * dt;
    car.x = clamp(car.x, 14, CFG.WORLD_W - 14);
    car.y = clamp(car.y, 14, CFG.WORLD_H - 14);
    if (car.health < 45) car.smoke += dt * (car.health < 22 ? 2.4 : 1);
  }

  // --- street-grid routing ----------------------------------------------
  // A route is a target junction plus the junction we came from, so the car
  // can pick a sensible next leg (no U-turns unless there is no choice).
  function nearestJunction(x, y) {
    const i = clamp(Math.round((x - CFG.ROAD / 2) / CFG.PITCH), 0, CFG.COLS);
    const j = clamp(Math.round((y - CFG.ROAD / 2) / CFG.PITCH), 0, CFG.ROWS);
    return { i, j, x: World.streetCX(i), y: World.streetCY(j) };
  }

  function nextJunction(rng, from, cameFrom, bias) {
    const options = [];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [di, dj] of dirs) {
      const ni = from.i + di, nj = from.j + dj;
      if (ni < 0 || ni > CFG.COLS || nj < 0 || nj > CFG.ROWS) continue;
      if (cameFrom && ni === cameFrom.i && nj === cameFrom.j) continue;
      options.push({ i: ni, j: nj, x: World.streetCX(ni), y: World.streetCY(nj) });
    }
    if (!options.length) return cameFrom || from;
    if (bias) {
      // Police routing: take the leg that ends nearest the target.
      let best = options[0], bestD = Infinity;
      for (const o of options) {
        const d = RNG.dist2(o.x, o.y, bias.x, bias.y) + rng.range(0, 900);
        if (d < bestD) { bestD = d; best = o; }
      }
      return best;
    }
    return rng.pick(options);
  }

  function ensureRoute(rng, car, bias) {
    if (!car.route) {
      const start = nearestJunction(car.x, car.y);
      car.route = { at: start, target: nextJunction(rng, start, null, bias), from: null };
    }
    return car.route;
  }

  // Drive toward a world point, in the right-hand lane where it matters.
  function controlToward(car, tx, ty, dt, opts) {
    const want = Math.atan2(ty - car.y, tx - car.x);
    const delta = angleDelta(car.angle, want);
    const steer = clamp(delta * 2.2, -1, 1);
    let throttle = 1;
    const d = dist(car.x, car.y, tx, ty);
    const targetSpeed = opts && opts.targetSpeed ? opts.targetSpeed : 300;
    if (car.speed > targetSpeed) throttle = 0;
    if (Math.abs(delta) > 2.2) {
      // The target is behind the car. At speed, brake; from a crawl, swing
      // the nose around by reversing on opposite lock (in reverse the
      // steering sign flips, which is what turns the heading toward it).
      if (car.speed < 120) return { throttle: -0.85, steer: -steer, handbrake: false };
      throttle = -0.7;
    }
    if (opts && opts.stopAt && d < opts.stopAt) throttle = car.speed > 8 ? -0.8 : 0;
    return { throttle, steer, handbrake: false };
  }

  // Traffic: follow the grid, keep to the right lane, stop for obstacles.
  function driveTraffic(G, car, dt) {
    const rng = G.rng;
    const route = ensureRoute(rng, car, null);
    // Lane point: the junction, shifted right of the direction of travel.
    const dx = route.target.x - car.x, dy = route.target.y - car.y;
    const d = Math.hypot(dx, dy) || 1;
    const laneX = route.target.x + (-dy / d) * 19;
    const laneY = route.target.y + (dx / d) * 19;
    if (d < 42) {
      const arrived = route.target;
      car.route = { at: arrived, target: nextJunction(rng, arrived, route.at, null), from: route.at };
    }
    // Obstacle ahead? Brake and wait.
    const aheadX = car.x + Math.cos(car.angle) * 52, aheadY = car.y + Math.sin(car.angle) * 52;
    let blocked = false;
    for (const other of G.cars) {
      if (other !== car && RNG.dist2(aheadX, aheadY, other.x, other.y) < 34 * 34) { blocked = true; break; }
    }
    if (!blocked && RNG.dist2(aheadX, aheadY, G.player.x, G.player.y) < 30 * 30 && !G.player.car) blocked = true;
    if (blocked) return { throttle: car.speed > 6 ? -0.9 : 0, steer: 0, handbrake: false };
    return controlToward(car, laneX, laneY, dt, { targetSpeed: 205 });
  }

  // Police: route by junction toward the player until close, then chase.
  function drivePolice(G, car, dt) {
    const rng = G.rng;
    const p = G.player;
    const dPlayer = dist(car.x, car.y, p.x, p.y);
    if (dPlayer < 300) {
      car.route = null;
      const control = controlToward(car, p.x, p.y, dt, { targetSpeed: 430 });
      // If alongside a slow player, hold position to run the bust clock.
      if (dPlayer < 64 && Math.abs(p.speedNow) < 46) return { throttle: car.speed > 6 ? -0.9 : 0, steer: control.steer, handbrake: false };
      return control;
    }
    const route = ensureRoute(rng, car, { x: p.x, y: p.y });
    if (dist(car.x, car.y, route.target.x, route.target.y) < 46) {
      const arrived = route.target;
      car.route = { at: arrived, target: nextJunction(rng, arrived, route.at, { x: p.x, y: p.y }), from: route.at };
    }
    return controlToward(car, route.target.x, route.target.y, dt, { targetSpeed: 395 });
  }

  // --- pedestrians --------------------------------------------------------
  function pickSidewalkTarget(G, ped) {
    const rng = G.rng;
    // Wander: a point on a random nearby block edge (the sidewalk ring).
    const i = clamp(Math.floor(ped.x / CFG.PITCH) + rng.int(-1, 1), 0, CFG.COLS - 1);
    const j = clamp(Math.floor(ped.y / CFG.PITCH) + rng.int(-1, 1), 0, CFG.ROWS - 1);
    const r = World.blockRect(i, j);
    const side = rng.int(0, 3);
    const t = rng.next();
    if (side === 0) return { x: r.x + t * r.w, y: r.y - 8 };
    if (side === 1) return { x: r.x + t * r.w, y: r.y + r.h + 8 };
    if (side === 2) return { x: r.x - 8, y: r.y + t * r.h };
    return { x: r.x + r.w + 8, y: r.y + t * r.h };
  }

  function stepPed(G, ped, dt) {
    const rng = G.rng;
    if (ped.state === 'down') {
      ped.downTimer -= dt;
      ped.speed = 0;
      if (ped.downTimer <= 0) { ped.state = 'flee'; ped.hp = 12; ped.fleeFrom = { x: G.player.x, y: G.player.y }; }
      return;
    }
    if (ped.state === 'ride') return;
    let speed = 0;
    if (ped.state === 'flee') {
      const from = ped.fleeFrom || G.player;
      const away = Math.atan2(ped.y - from.y, ped.x - from.x);
      ped.angle = RNG.angleLerp(ped.angle, away, Math.min(1, dt * 6));
      speed = 205;
      if (RNG.dist2(ped.x, ped.y, from.x, from.y) > 320 * 320) ped.state = 'walk';
    } else if (ped.state === 'hail') {
      ped.speed = 0;
      return; // stand and wave until a car stops or the moment passes
    } else {
      if (!ped.target || RNG.dist2(ped.x, ped.y, ped.target.x, ped.target.y) < 18 * 18) {
        ped.waitTimer -= dt;
        if (ped.waitTimer <= 0) { ped.target = pickSidewalkTarget(G, ped); ped.waitTimer = rng.range(0, 2.5); }
      } else {
        const want = Math.atan2(ped.target.y - ped.y, ped.target.x - ped.x);
        ped.angle = RNG.angleLerp(ped.angle, want, Math.min(1, dt * 5));
        speed = 68;
      }
    }
    ped.speed = speed;
    ped.x += Math.cos(ped.angle) * speed * dt;
    ped.y += Math.sin(ped.angle) * speed * dt;
    const push = World.collideCircle(ped.x, ped.y, CFG.FOOT.radius);
    if (push) { ped.x += push.dx; ped.y += push.dy; ped.target = null; }
    ped.x = clamp(ped.x, 10, CFG.WORLD_W - 10);
    ped.y = clamp(ped.y, 10, CFG.WORLD_H - 10);
    if (World.isWater(ped.x, ped.y)) { ped.y = CFG.WATER_Y - 12; ped.target = null; }
  }

  return { makeCar, makePed, stepCar, driveTraffic, drivePolice, stepPed, nearestJunction };
})();
