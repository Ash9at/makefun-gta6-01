// world.js — builds the city of Solmaris from a seed.
//
// Streets are bands on a grid (see config.js); the rectangles between them
// are blocks, and each block is filled with one, two or four buildings in a
// mix of styles. A few blocks are reserved for the places the story needs:
// the police station, the hospital, Marisol Vega's warehouse and the garage
// she sends you to. South of the last street: the beach, the pier, the sea.

const World = (() => {
  const { PITCH, ROAD, COLS, ROWS } = CFG;

  const streetCX = (i) => i * PITCH + ROAD / 2;   // centre line of vertical street i
  const streetCY = (j) => j * PITCH + ROAD / 2;   // centre line of horizontal street j

  // Which district each block belongs to, row by row, west to east.
  const DISTRICT_MAP = [
    [5, 5, 3, 3, 3, 4, 4, 6],
    [5, 2, 3, 3, 1, 1, 6, 6],
    [2, 2, 1, 1, 1, 0, 0, 6],
    [2, 1, 1, 3, 0, 0, 0, 6],
    [7, 1, 3, 3, 0, 0, 4, 6],
    [7, 7, 2, 2, 1, 4, 4, 6],
    [7, 7, 7, 2, 2, 4, 6, 6],
  ];

  const WALL_COLORS = ['#e8d8b8', '#d9a066', '#c96f4a', '#e5e0d5', '#b8c4ce', '#d98c8c', '#a8b89a', '#e0c878', '#cbb7a6', '#9fb6c9'];
  const ROOF_STYLES = ['flat', 'parapet', 'terrace', 'dome', 'solar', 'garden', 'tiled'];
  const WINDOW_PATTERNS = ['grid', 'strips', 'arched', 'shutters'];

  function blockRect(i, j) {
    return { x: i * PITCH + ROAD, y: j * PITCH + ROAD, w: PITCH - ROAD, h: PITCH - ROAD };
  }

  function makeBuilding(rng, x, y, w, h, kind) {
    const floors = kind === 'tower' ? rng.int(6, 10) : kind === 'house' ? 1 : rng.int(2, 5);
    return {
      x, y, w, h, kind,
      floors,
      height: 5 + floors * 3.4,
      wall: rng.pick(WALL_COLORS),
      roofStyle: kind === 'house' ? 'tiled' : rng.pick(ROOF_STYLES),
      windows: rng.pick(WINDOW_PATTERNS),
      seed: rng.int(1, 1e9),
      name: null,
    };
  }

  function fillBlock(buildings, rng, i, j) {
    const r = blockRect(i, j);
    const inset = 12;
    const x = r.x + inset, y = r.y + inset, w = r.w - inset * 2, h = r.h - inset * 2;
    const layout = rng.pick(['single', 'pair', 'quad', 'single', 'pair']);
    if (layout === 'single') {
      buildings.push(makeBuilding(rng, x, y, w, h, rng.chance(0.3) ? 'tower' : 'slab'));
    } else if (layout === 'pair') {
      const vertical = rng.chance(0.5);
      const gap = 10;
      if (vertical) {
        const w1 = (w - gap) / 2;
        buildings.push(makeBuilding(rng, x, y, w1, h, 'slab'));
        buildings.push(makeBuilding(rng, x + w1 + gap, y, w1, h, 'slab'));
      } else {
        const h1 = (h - gap) / 2;
        buildings.push(makeBuilding(rng, x, y, w, h1, 'slab'));
        buildings.push(makeBuilding(rng, x, y + h1 + gap, w, h1, 'slab'));
      }
    } else {
      const gap = 10, w1 = (w - gap) / 2, h1 = (h - gap) / 2;
      for (const [bx, by] of [[x, y], [x + w1 + gap, y], [x, y + h1 + gap], [x + w1 + gap, y + h1 + gap]]) {
        buildings.push(makeBuilding(rng, bx, by, w1, h1, rng.chance(0.4) ? 'house' : 'slab'));
      }
    }
  }

  function build(seed) {
    const rng = RNG.stream(seed * 7919 + 13);
    const buildings = [];
    const shops = [];
    const lights = [];
    const palms = [];
    const parkedSpots = [];

    // Reserved blocks first: their buildings are placed by hand below, so the
    // filler skips them. Block coordinates are [column, row].
    const reserved = new Map([
      ['3,2', 'station'],   // police station, Centro
      ['1,1', 'hospital'],  // hospital, University Quarter side
      ['6,5', 'warehouse'], // Vega Logistics warehouse, Harbor Point
      ['0,5', 'plaza'],     // Mercado plaza: open ground, the rampage ring
    ]);

    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < COLS; i++) {
        if (!reserved.has(`${i},${j}`)) fillBlock(buildings, rng, i, j);
      }
    }

    const placeSpecial = (key, kind, name, wall) => {
      const [i, j] = key.split(',').map(Number);
      const r = blockRect(i, j);
      const b = makeBuilding(rng, r.x + 16, r.y + 16, r.w - 32, r.h - 32, kind);
      b.name = name;
      b.wall = wall;
      b.roofStyle = 'flat';
      b.floors = 3;
      b.height = 15;
      buildings.push(b);
      return b;
    };
    const station = placeSpecial('3,2', 'station', 'Solmaris Police', '#7d8ea3');
    const hospital = placeSpecial('1,1', 'hospital', 'Hospital del Mar', '#eef0ea');
    const warehouse = placeSpecial('6,5', 'warehouse', 'Vega Logistics', '#a3764f');

    // Shops: dress some street-facing slabs with a name and a sign. A shop is
    // a building plus an entrance point on its street side, used by taxi
    // destinations and deliveries.
    const slabs = buildings.filter((b) => b.kind === 'slab' || b.kind === 'tower');
    for (let n = 0; n < CFG.SHOP_NAMES.length && n < slabs.length; n++) {
      const b = slabs[Math.floor((n + 0.5) * slabs.length / CFG.SHOP_NAMES.length)];
      if (b.name) continue;
      b.kind = 'shop';
      b.name = CFG.SHOP_NAMES[n];
      shops.push({ building: b, x: b.x + b.w / 2, y: b.y + b.h + 16, name: b.name });
    }

    // Streetlights: along every street, alternating sides.
    for (let i = 0; i <= COLS; i++) {
      for (let y = 60; y < CFG.CITY_H; y += 150) lights.push({ x: streetCX(i) + (Math.floor(y / 150) % 2 ? 40 : -40), y });
    }
    for (let j = 0; j <= ROWS; j++) {
      for (let x = 60; x < CFG.WORLD_W; x += 170) lights.push({ x, y: streetCY(j) + (Math.floor(x / 170) % 2 ? 40 : -40) });
    }

    // Palms along the beach and scattered through the southern blocks.
    for (let x = 40; x < CFG.WORLD_W; x += 90) {
      palms.push({ x: x + rng.range(-18, 18), y: CFG.BEACH_Y + rng.range(24, 90), s: rng.range(0.8, 1.3) });
    }
    for (let n = 0; n < 26; n++) {
      palms.push({ x: rng.range(30, CFG.WORLD_W - 30), y: rng.range(1750, CFG.BEACH_Y - 20), s: rng.range(0.7, 1.1) });
    }

    // Parked-car spots: nose-to-kerb along the south and east edge of blocks.
    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < COLS; i++) {
        const r = blockRect(i, j);
        if (rng.chance(0.75)) parkedSpots.push({ x: r.x + rng.range(20, r.w - 20), y: r.y + r.h + 13, angle: 0 });
        if (rng.chance(0.55)) parkedSpots.push({ x: r.x + r.w + 13, y: r.y + rng.range(20, r.h - 20), angle: Math.PI / 2 });
      }
    }

    const pier = { x: 1300, y: CFG.BEACH_Y, w: 68, h: 470 };
    const lighthouse = { x: pier.x + pier.w / 2, y: pier.y + pier.h - 26, r: 17 };

    return {
      seed, buildings, shops, lights, palms, parkedSpots, pier, lighthouse,
      station, hospital, warehouse,
      garage: { x: warehouse.x + warehouse.w / 2, y: warehouse.y + warehouse.h + 26 },
      plaza: (() => { const r = blockRect(0, 5); return { x: r.x + r.w / 2, y: r.y + r.h / 2, r: 62 }; })(),
    };
  }

  function districtAt(x, y) {
    if (y >= CFG.WATER_Y) return 'The Open Sea';
    if (y >= CFG.BEACH_Y) return 'Marina del Sol';
    const i = Math.max(0, Math.min(COLS - 1, Math.floor(x / PITCH)));
    const j = Math.max(0, Math.min(ROWS - 1, Math.floor(y / PITCH)));
    return CFG.DISTRICTS[DISTRICT_MAP[j][i]];
  }

  function isWater(x, y) { return y >= CFG.WATER_Y && !(x >= 1300 && x <= 1368 && y <= CFG.BEACH_Y + 470); }
  function isSand(x, y) { return y >= CFG.BEACH_Y && y < CFG.WATER_Y; }

  // Circle vs building collision: returns a push-out correction or null.
  function collideCircle(x, y, r) {
    let dx = 0, dy = 0;
    for (const b of World.current.buildings) {
      const nx = Math.max(b.x, Math.min(x, b.x + b.w));
      const ny = Math.max(b.y, Math.min(y, b.y + b.h));
      const ddx = x - nx, ddy = y - ny;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < r * r) {
        if (d2 > 0.0001) {
          const d = Math.sqrt(d2), push = (r - d) / d;
          dx += ddx * push; dy += ddy * push;
        } else {
          dy -= r; // centre inside the box: push north out
        }
      }
    }
    return dx === 0 && dy === 0 ? null : { dx, dy };
  }

  return { build, streetCX, streetCY, blockRect, districtAt, isWater, isSand, collideCircle, current: null };
})();
