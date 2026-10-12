/** Seeded RNG: mulberry32 uniforms + Box-Muller normals. */
export function createRng(seed: number): { uniform(): number; normal(): number } {
  let a = seed >>> 0
  let spare: number | null = null

  function uniform(): number {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  function normal(): number {
    if (spare !== null) {
      const s = spare
      spare = null
      return s
    }
    // 1 - u is in (0, 1], so log() is finite.
    const u1 = 1 - uniform()
    const u2 = uniform()
    const r = Math.sqrt(-2 * Math.log(u1))
    spare = r * Math.sin(2 * Math.PI * u2)
    return r * Math.cos(2 * Math.PI * u2)
  }

  return { uniform, normal }
}
