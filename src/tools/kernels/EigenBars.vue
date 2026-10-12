<script setup lang="ts">
/**
 * Bars of the smallest eigenvalues on a symmetric log scale: a bar of λ/max|λ| = ρ has height
 * (log₁₀|ρ| + 8)/8 of the half axis, upwards for ρ > 0 and downwards for ρ < 0. |ρ| ≤ 1e-8 counts as zero
 * (grey stub on the axis), so rounding noise of a valid kernel is never shown as a negative bar.
 */
import { computed } from 'vue'
import { useI18n } from '../../i18n'
import type { EigenBar } from './compute'

const props = defineProps<{ bars: EigenBar[]; label: string }>()
const { lang, t } = useI18n()

const W = 900
const H = 190
const margin = { top: 10, right: 10, bottom: 24, left: 58 }
const innerW = W - margin.left - margin.right
const innerH = H - margin.top - margin.bottom
const half = innerH / 2
const DECADES = 8
const STUB = 3

/** Signed position on the half axis in [−1, 1]. */
function level(rel: number): number {
  const a = Math.abs(rel)
  if (a <= 10 ** -DECADES) return 0
  return Math.sign(rel) * Math.min(1, (Math.log10(a) + DECADES) / DECADES)
}

const sci = computed(() => new Intl.NumberFormat(lang.value, { notation: 'scientific', maximumFractionDigits: 2 }))

const rects = computed(() => {
  const n = props.bars.length
  const step = n ? innerW / n : innerW
  const w = Math.max(2, step * 0.72)
  return props.bars.map((b, i) => {
    const x = i * step + (step - w) / 2
    const h = level(b.rel) * half
    if (b.cls === 'zero') return { ...b, x, w, y: half - STUB / 2, h: STUB, title: t('kernels.validity.barTitle', { i: b.index, v: sci.value.format(b.rel) }) }
    return {
      ...b,
      x,
      w,
      y: h >= 0 ? half - h : half,
      h: Math.max(Math.abs(h), 1),
      title: t('kernels.validity.barTitle', { i: b.index, v: sci.value.format(b.rel) }),
    }
  })
})

const sub = (n: number) => String(n).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)])

const ticks = [
  { v: 1, label: '1' },
  { v: 0.5, label: '10⁻⁴' },
  { v: 0, label: '0' },
  { v: -0.5, label: '−10⁻⁴' },
  { v: -1, label: '−1' },
]
</script>

<template>
  <svg class="eigen" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="label">
    <g :transform="`translate(${margin.left},${margin.top})`">
      <g class="grid" aria-hidden="true">
        <g v-for="tk in ticks" :key="tk.v" :transform="`translate(0,${half - tk.v * half})`">
          <line :x2="innerW" :class="{ zero: tk.v === 0 }" />
          <text x="-8" dy="0.32em" text-anchor="end">{{ tk.label }}</text>
        </g>
      </g>
      <rect
        v-for="r in rects"
        :key="r.index"
        :x="r.x"
        :y="r.y"
        :width="r.w"
        :height="r.h"
        :data-eigen="r.cls"
        class="bar"
      >
        <title>{{ r.title }}</title>
      </rect>
      <text class="axis-note" :x="innerW / 2" :y="innerH + 17" text-anchor="middle">λ₁ ≤ λ₂ ≤ … ≤ λ{{ sub(bars.length) }}</text>
    </g>
  </svg>
</template>

<style scoped>
.eigen {
  width: 100%;
  height: auto;
  display: block;
  font-size: 13px;
}
.grid line {
  stroke: var(--grid);
}
.grid line.zero {
  stroke: var(--axis);
}
.grid text,
.axis-note {
  fill: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.bar[data-eigen='positive'] {
  fill: var(--accent);
}
.bar[data-eigen='zero'] {
  fill: var(--text-muted);
  opacity: 0.7;
}
.bar[data-eigen='negative'] {
  fill: var(--error);
}
</style>
