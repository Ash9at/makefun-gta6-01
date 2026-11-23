// missions.js — the work: Marisol Vega's five-job story chain, taxi fares,
// and the Mercado rampage.
//
// Marisol runs Vega Logistics out of a harbor warehouse and pays cash for
// driving she cannot put on the books. Her jobs chain: finish one and the
// next call comes in. Each job is a small state machine over G.job; this
// file sets stages and targets, and main.js pays out and shows the words.

const Mis = (() => {
  const FIXER = 'Marisol Vega';

  const JOBS = [
    {
      id: 'wheels', title: 'Borrowed Wheels', pay: 450, respect: 2,
      intro: [
        'Marisol: You came. Good. I need a car that is not mine and a driver who is not on my payroll.',
        'Marisol: A gold coupe is parked up on Neon Mile. Take it. Bring it to my warehouse garage.',
        'Marisol: Scratch it and I scratch your fee. Drive.',
      ],
      outro: 'Marisol: Clean work. The money is yours. Stay near your phone.',
    },
    {
      id: 'package', title: 'Pier Package', pay: 700, respect: 2,
      intro: [
        'Marisol: A crate came in on the night boat. It sits at the end of the pier, and it is not fish.',
        'Marisol: Pick it up on foot, then take it to Café Brisa. The clock starts when you touch it.',
        'Marisol: Do not open it. Curiosity is expensive in this town.',
      ],
      outro: 'Marisol: The café owner sends his thanks. So do I.',
    },
    {
      id: 'drops', title: 'Three Drops', pay: 1000, respect: 3,
      intro: [
        'Marisol: Three briefcases, three corners of Solmaris. Debts my clients forgot to pay.',
        'Marisol: Collect all three. Each one will make the police curious. Be quick, be gone.',
      ],
      outro: 'Marisol: All three. You are becoming reliable. That is rare here.',
    },
    {
      id: 'shipment', title: 'Heavy Shipment', pay: 1400, respect: 3,
      intro: [
        'Marisol: My van is loaded at Harbor Point and the port police are already watching it.',
        'Marisol: Take the van to the Old Port warehouse. They will follow. Lose them or outrun them.',
        'Marisol: The van matters more than you do. No offence.',
      ],
      outro: 'Marisol: The shipment is safe. You are worth your price, driver.',
    },
    {
      id: 'sunset', title: 'Into the Sunset', pay: 2000, respect: 5,
      intro: [
        'Marisol: One last job. Every badge in Solmaris will be looking for you tonight.',
        'Marisol: Get to the lighthouse at the end of the pier before the light turns. That is all.',
        'Marisol: Survive it, and this city is yours. I retire. You inherit the phone.',
      ],
      outro: 'Marisol: You made it. Solmaris is yours now, my friend. Use it gently.',
    },
  ];

  function jobTarget(G, x, y, label) {
    G.job.target = { x, y, label };
  }

  function startJob(G, index) {
    const def = JOBS[index];
    G.job = { index, id: def.id, stage: 'start', target: null, timer: 0, data: {}, done: false, failed: false };
    G.say(FIXER, def.intro);
    const W = G.world;
    if (def.id === 'wheels') {
      // A gold coupe parked on Neon Mile (east side, row 2): on the street
      // itself, clear of the buildings that fill the blocks.
      const spot = { x: World.streetCX(6), y: World.streetCY(2) + 130 };
      const car = Ent.makeCar(spot.x, spot.y, Math.PI / 2, 'mission', G.rng);
      car.color = '#d9a514';
      car.isObjectiveCar = true;
      G.cars.push(car);
      G.job.data.car = car;
      G.job.stage = 'steal';
      jobTarget(G, car.x, car.y, 'Steal the gold coupe');
    } else if (def.id === 'package') {
      G.job.stage = 'pickup';
      jobTarget(G, W.lighthouse.x, W.lighthouse.y - 60, 'Pick up the crate at the pier');
    } else if (def.id === 'drops') {
      const spots = [
        { x: World.streetCX(1), y: World.streetCY(5) + 70 },
        { x: World.streetCX(7), y: World.streetCY(1) + 70 },
        { x: World.streetCX(4), y: World.streetCY(6) },
      ];
      G.job.data.drops = spots.map((s) => ({ ...s, taken: false }));
      G.job.stage = 'collect';
      jobTarget(G, spots[0].x, spots[0].y, 'Collect the briefcases (0/3)');
    } else if (def.id === 'shipment') {
      const spot = { x: World.streetCX(7), y: World.streetCY(5) + 90 };
      const van = Ent.makeCar(spot.x, spot.y, -Math.PI / 2, 'mission', G.rng);
      van.color = '#4a6b8a';
      van.isObjectiveCar = true;
      van.health = 160;
      G.cars.push(van);
      G.job.data.car = van;
      G.job.stage = 'steal';
      jobTarget(G, van.x, van.y, 'Take the loaded van');
    } else if (def.id === 'sunset') {
      G.job.stage = 'go';
      G.job.timer = 180;
      G.minStars = 4;
      jobTarget(G, W.lighthouse.x, W.lighthouse.y, 'Reach the lighthouse');
    }
    return def;
  }

  function completeJob(G) {
    const def = JOBS[G.job.index];
    G.job.done = true;
    G.minStars = 0;
    G.player.cash += def.pay;
    G.player.respect += def.respect;
    G.stats.jobsDone += 1;
    G.stats.earned += def.pay;
    G.say(FIXER, [def.outro]);
    G.toast(`Job complete: ${def.title}  +$${def.pay}`);
    G.sfx('cash');
  }

  function failSoft(G, message) {
    // Timed stages restart instead of ending the story: friendlier, and the
    // chain never dead-ends.
    G.toast(message);
    const def = JOBS[G.job.index];
    if (def.id === 'package' && G.job.stage === 'deliver') {
      G.job.stage = 'pickup';
      G.job.timer = 0;
      jobTarget(G, G.world.lighthouse.x, G.world.lighthouse.y - 60, 'Pick up the crate at the pier');
    } else if (def.id === 'sunset') {
      G.job.timer = 180;
      G.minStars = 4;
    }
  }

  function updateJob(G, dt) {
    const job = G.job;
    if (!job || job.done) return;
    const p = G.player;
    const near = (t, r) => t && RNG.dist(p.x, p.y, t.x, t.y) < r;

    if (job.id === 'wheels' || job.id === 'shipment') {
      if (job.stage === 'steal') {
        jobTarget(G, job.data.car.x, job.data.car.y, job.id === 'wheels' ? 'Steal the gold coupe' : 'Take the loaded van');
        if (p.car === job.data.car) {
          job.stage = 'deliver';
          if (job.id === 'shipment') { G.minStars = 3; G.addHeat(40); }
          const dest = job.id === 'wheels' ? G.world.garage : { x: World.streetCX(2), y: World.streetCY(1) + 40 };
          job.data.dest = dest;
          jobTarget(G, dest.x, dest.y, job.id === 'wheels' ? 'Deliver to the Vega garage' : 'Deliver to the Old Port warehouse');
          G.toast('Now deliver it — follow the marker');
        }
      } else if (job.stage === 'deliver') {
        if (p.car === job.data.car && near(job.data.dest, 58)) completeJob(G);
      }
    } else if (job.id === 'package') {
      if (job.stage === 'pickup' && !p.car && near(job.target, 30)) {
        job.stage = 'deliver';
        job.timer = 150;
        const cafe = G.world.shops.find((s) => s.name === 'Café Brisa') || G.world.shops[0];
        job.data.dest = cafe;
        jobTarget(G, cafe.x, cafe.y, 'Deliver to Café Brisa');
        G.toast('Package picked up — the clock is running');
        G.sfx('pickup');
      } else if (job.stage === 'deliver') {
        job.timer -= dt;
        if (job.timer <= 0) failSoft(G, 'Too slow — the crate is back at the pier');
        else if (near(job.data.dest, 40)) completeJob(G);
      }
    } else if (job.id === 'drops') {
      let left = 0, next = null;
      for (const d of job.data.drops) {
        if (d.taken) continue;
        left += 1;
        if (!next) next = d;
        if (RNG.dist(p.x, p.y, d.x, d.y) < 30) {
          d.taken = true;
          G.addHeat(34);
          G.sfx('pickup');
          G.toast('Briefcase collected');
          left -= 1;
        }
      }
      if (left === 0) completeJob(G);
      else if (next) jobTarget(G, next.x, next.y, `Collect the briefcases (${3 - left}/3)`);
    } else if (job.id === 'sunset') {
      job.timer -= dt;
      if (job.timer <= 0) failSoft(G, 'The light turned — try again, the heat stays on');
      else if (near(job.target, 46)) completeJob(G);
    }
  }

  // --- taxi ---------------------------------------------------------------
  function startFare(G, ped) {
    const dest = G.rng.pick(G.world.shops);
    const d = RNG.dist(ped.x, ped.y, dest.x, dest.y);
    G.taxi = {
      stage: 'deliver', ped, dest,
      fare: Math.round(16 + d / 22),
      timer: Math.max(45, d / 9.5),
      totalTime: Math.max(45, d / 9.5),
    };
    ped.state = 'ride';
    G.toast(`Taxi: take your passenger to ${dest.name}`);
    G.sfx('pickup');
  }

  function updateTaxi(G, dt) {
    const taxi = G.taxi;
    if (!taxi) return;
    taxi.timer -= dt;
    if (taxi.timer <= 0) {
      G.toast('The passenger gave up and got out');
      endFare(G, false);
      return;
    }
    if (RNG.dist(G.player.x, G.player.y, taxi.dest.x, taxi.dest.y) < 44 && Math.abs(G.player.speedNow) < 30) {
      const tip = taxi.timer > taxi.totalTime * 0.4 ? Math.round(taxi.fare * 0.5) : 0;
      G.player.cash += taxi.fare + tip;
      G.player.respect += 1;
      G.stats.earned += taxi.fare + tip;
      G.stats.taxiFares += 1;
      G.toast(`Fare paid: $${taxi.fare}${tip ? ` + $${tip} tip` : ''}`);
      G.sfx('cash');
      endFare(G, true);
    }
  }

  function endFare(G, arrived) {
    const ped = G.taxi.ped;
    ped.state = 'walk';
    ped.target = null;
    ped.x = G.player.x + 26;
    ped.y = G.player.y + 10;
    if (!G.peds.includes(ped)) G.peds.push(ped);
    if (G.player.car && G.player.car.passenger === ped) G.player.car.passenger = null;
    G.taxi = null;
  }

  // --- rampage --------------------------------------------------------------
  function updateRampage(G, dt) {
    const r = G.rampage;
    r.cooldown = Math.max(0, r.cooldown - dt);
    if (!r.active) {
      const plaza = G.world.plaza;
      if (r.cooldown <= 0 && RNG.dist(G.player.x, G.player.y, plaza.x, plaza.y) < plaza.r) {
        r.active = true;
        r.timeLeft = 45;
        r.points = 0;
        G.toast('RAMPAGE! Score 300 in 45 seconds: wreck cars, scatter crowds');
        G.sfx('horn');
      }
      return;
    }
    r.timeLeft -= dt;
    if (r.timeLeft <= 0) {
      r.active = false;
      r.cooldown = 90;
      if (r.points >= 300) {
        G.player.cash += 500;
        G.player.respect += 3;
        G.stats.earned += 500;
        G.toast(`Rampage cleared with ${r.points} points! +$500`);
        G.sfx('cash');
      } else {
        G.toast(`Rampage over: ${r.points}/300 points`);
      }
    }
  }

  function rampageScore(G, kind) {
    const r = G.rampage;
    if (!r.active) return;
    const points = { wreck: 60, hit: 10, scare: 15, ko: 25 }[kind] || 0;
    r.points += points;
    if (points) G.floatText(`+${points}`, G.player.x, G.player.y - 30, '#ffd76a');
  }

  return { JOBS, FIXER, startJob, updateJob, startFare, updateTaxi, updateRampage, rampageScore };
})();
