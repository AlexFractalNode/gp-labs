<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from '../i18n'
import type { Mat } from '../core/linalg'

const props = withDefaults(defineProps<{ matrix: Mat; diverging?: boolean; label?: string }>(), {
  diverging: false,
})
const { t } = useI18n()
const ariaLabel = computed(() => props.label ?? t('plot.heatmap'))
const empty = computed(() => props.matrix.rows === 0 || props.matrix.cols === 0)
/** Finite value range, shown as text legend. */
const range = computed(() => {
  let lo = Infinity
  let hi = -Infinity
  for (const v of props.matrix.data) {
    if (!Number.isFinite(v)) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return Number.isFinite(lo) ? { min: lo, max: hi } : null
})
const fmt = (v: number) => String(Number(v.toPrecision(3)))
const legend = computed(() =>
  range.value ? t('plot.range', { min: fmt(range.value.min), max: fmt(range.value.max) }) : '',
)
const canvas = ref<HTMLCanvasElement | null>(null)

type RGB = [number, number, number]
// Sequential: pale yellow to deep blue (colour-blind safe); diverging: blue - white - orange.
const SEQ: RGB[] = [
  [247, 245, 225],
  [160, 205, 200],
  [60, 130, 170],
  [25, 50, 110],
]
const DIV: RGB[] = [
  [33, 90, 160],
  [255, 255, 255],
  [214, 110, 30],
]

function ramp(stops: RGB[], u: number): RGB {
  const s = Math.min(Math.max(u, 0), 1) * (stops.length - 1)
  const i = Math.min(Math.floor(s), stops.length - 2)
  const f = s - i
  return [0, 1, 2].map((k) => Math.round(stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f)) as RGB
}

function draw() {
  const el = canvas.value
  if (!el) return
  const { rows, cols, data } = props.matrix
  if (empty.value) return
  const ctx = el.getContext('2d')
  if (!ctx) return // e.g. happy-dom: nothing to draw into
  el.width = cols
  el.height = rows
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    if (!Number.isFinite(v)) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const m = Math.max(Math.abs(lo), Math.abs(hi))
  const img = ctx.createImageData(cols, rows)
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    let c: RGB
    if (!Number.isFinite(v) || !Number.isFinite(lo)) c = [128, 128, 128]
    else if (props.diverging) c = ramp(DIV, m > 0 ? 0.5 + v / (2 * m) : 0.5)
    else c = ramp(SEQ, hi > lo ? (v - lo) / (hi - lo) : 0)
    img.data[4 * i] = c[0]
    img.data[4 * i + 1] = c[1]
    img.data[4 * i + 2] = c[2]
    img.data[4 * i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
}

onMounted(draw)
watch(() => [props.matrix, props.diverging], draw)
</script>

<template>
  <figure class="heatmap-fig" data-verify-unit="heatmap" :data-verify-state="empty ? 'empty' : 'ready'" :data-verify-count="matrix.rows * matrix.cols">
    <canvas v-show="!empty" ref="canvas" class="heatmap" role="img" :aria-label="ariaLabel" />
    <figcaption v-if="legend">{{ legend }}</figcaption>
  </figure>
</template>

<style scoped>
.heatmap-fig {
  margin: 0;
}
figcaption {
  font-size: 0.8rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.heatmap {
  width: 100%;
  aspect-ratio: 1;
  image-rendering: pixelated;
  border: 1px solid var(--border);
  background: var(--surface);
}
</style>
