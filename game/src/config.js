// config.js — the shape of Solmaris: grid dimensions, tuning numbers, names.
//
// Streets run on a grid of bands. Vertical street i is the band
// [i*PITCH, i*PITCH + ROAD] and horizontal street j likewise, so the blocks
// between bands form an 8 by 7 field of city blocks. South of the last street
// the ground gives way to the beach, then the sea, then the pier.

const CFG = (() => {
  const PITCH = 300;          // distance between street band starts
  const ROAD = 96;            // street band width (asphalt plus margins)
  const COLS = 8;             // blocks across
  const ROWS = 7;             // blocks down
  const WORLD_W = (COLS + 1) * PITCH;         // 2700: one more street than blocks
  const CITY_H = (ROWS + 1) * PITCH;          // 2400: last street band ends at 2196
  const BEACH_Y = 2196;       // sand starts where the last street ends
  const WATER_Y = 2440;       // open water starts here
  const WORLD_H = 2820;       // southern edge of the world (in the sea)

  const DAY_LENGTH = 300;     // seconds of play per full day-night cycle
  const SAVE_KEY = 'solmaris-heat-save-v1';

  const DISTRICTS = [
    'Neon Mile', 'Mercado District', 'Old Port', 'Centro',
    'Las Palmas Heights', 'University Quarter', 'Harbor Point', 'Marina del Sol',
  ];

  const SHOP_NAMES = [
    'Café Brisa', 'Tienda Sol', 'Licores Mar', 'Farmacia Vida', 'Taller Ruiz',
    'Panadería Oro', 'Hotel Palma', 'Banco Costa', 'Gimnasio Fuego', 'Joyas Luna',
    'Barbería Norte', 'Flores del Mar', 'Óptica Clara', 'Discos Ola', 'Mariscos Rey',
    'Librería Faro', 'Zapatería Andar', 'Cine Solmaris', 'Tatuajes Irezumi', 'Dulce Vida',
  ];

  const CAR_COLORS = [
    '#e8e4da', '#c33b2e', '#2e6fc3', '#f2b134', '#3fa34d', '#7a4fa3',
    '#e2713a', '#39b5a8', '#d669a8', '#5a6270', '#20242c', '#8c2f4d',
  ];
  const PED_COLORS = [
    '#e74c3c', '#f39c12', '#27ae60', '#2980b9', '#9b59b6', '#fd79a8',
    '#00b894', '#e17055', '#6c5ce7', '#fdcb6e', '#dfe6e9', '#b2bec3',
  ];

  // Physics and feel.
  const FOOT = { walk: 138, run: 238, radius: 11, punchRange: 50, punchArc: 1.15 };
  const CAR = {
    radius: 17, accel: 340, brake: 520, reverse: 150, maxSpeed: 430,
    maxReverse: 130, grip: 7.5, driftGrip: 2.1, turnRate: 2.35,
  };
  const HEAT = {
    carjack: 26, steal: 12, koPed: 16, koCop: 65, shot: 7, hitCar: 6,
    destroyCar: 32, hitProp: 4, perStar: 30, decay: 1.1, decaySeen: 0.25,
  };

  return {
    PITCH, ROAD, COLS, ROWS, WORLD_W, WORLD_H, CITY_H, BEACH_Y, WATER_Y,
    DAY_LENGTH, SAVE_KEY, DISTRICTS, SHOP_NAMES, CAR_COLORS, PED_COLORS,
    FOOT, CAR, HEAT,
  };
})();
