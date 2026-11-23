// rng.js — deterministic randomness and small math helpers for Solmaris Heat.
//
// The whole city is generated from one seed so a given seed always builds the
// same streets, the same buildings and the same parked cars. The screenshot
// scenes rely on that: they name a seed and get the same frame every time.

const RNG = (() => {
  // mulberry32: a tiny, fast, seedable PRNG with a decent spread.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A stream you can reseed per system, so worldgen and gameplay do not
  // fight over one sequence.
  function stream(seed) {
    const next = mulberry32(seed);
    return {
      next,
      range(lo, hi) { return lo + next() * (hi - lo); },
      int(lo, hi) { return Math.floor(lo + next() * (hi - lo + 1)); },
      pick(list) { return list[Math.floor(next() * list.length)]; },
      chance(p) { return next() < p; },
      sign() { return next() < 0.5 ? -1 : 1; },
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function dist(ax, ay, bx, by) { return Math.sqrt(dist2(ax, ay, bx, by)); }

  // Shortest signed difference between two headings, in (-PI, PI].
  function angleDelta(from, to) {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  function angleLerp(from, to, t) { return from + angleDelta(from, to) * t; }
  function heading(dx, dy) { return Math.atan2(dy, dx); }

  return { mulberry32, stream, clamp, lerp, dist, dist2, angleDelta, angleLerp, heading };
})();
