<script setup lang="ts">
import { computed, provide, ref, useId } from 'vue'
import { scaleLinear } from 'd3-scale'
import { PLOT_SCALES, type PlotScales } from './plotScales'

const props = withDefaults(
  defineProps<{
    xDomain: [number, number]
    yDomain: [number, number]
    width?: number
    height?: number
    xLabel: string
    yLabel: string
  }>(),
  { width: 640, height: 360 },
)
const emit = defineEmits<{
  'plot-click': [p: { x: number; y: number }]
  'plot-contextmenu': [p: { x: number; y: number }]
  'plot-hover': [p: { x: number } | null]
}>()

const margin = { top: 12, right: 16, bottom: 44, left: 56 }
const svg = ref<SVGSVGElement | null>(null)
const innerW = computed(() => props.width - margin.left - margin.right)
const innerH = computed(() => props.height - margin.top - margin.bottom)
const xScale = computed(() => scaleLinear().domain(props.xDomain).range([0, innerW.value]))
const yScale = computed(() => scaleLinear().domain(props.yDomain).range([innerH.value, 0]))
const xTicks = computed(() => xScale.value.ticks(6))
const yTicks = computed(() => yScale.value.ticks(5))
const fx = computed(() => xScale.value.tickFormat(6))
const fy = computed(() => yScale.value.tickFormat(5))

function toData(clientX: number, clientY: number): { x: number; y: number } | null {
  const el = svg.value
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return null
  const px = ((clientX - r.left) / r.width) * props.width - margin.left
  const py = ((clientY - r.top) / r.height) * props.height - margin.top
  return { x: xScale.value.invert(px), y: yScale.value.invert(py) }
}

const scales = computed<PlotScales>(() => ({ x: xScale.value, y: yScale.value, toData }))
provide(PLOT_SCALES, scales)

const clipId = `plot-clip-${useId()}`

function onClick(e: MouseEvent) {
  const p = toData(e.clientX, e.clientY)
  if (p) emit('plot-click', p)
}
function onContext(e: MouseEvent) {
  e.preventDefault()
  const p = toData(e.clientX, e.clientY)
  if (p) emit('plot-contextmenu', p)
}
// Handled on the whole svg, so hover stays active while the pointer is over a point.
function onMove(e: MouseEvent) {
  const p = toData(e.clientX, e.clientY)
  const [x0, x1] = props.xDomain
  emit('plot-hover', p && p.x >= Math.min(x0, x1) && p.x <= Math.max(x0, x1) ? { x: p.x } : null)
}
</script>

<template>
  <svg
    ref="svg"
    class="plot"
    :viewBox="`0 0 ${width} ${height}`"
    role="group"
    :aria-label="`${yLabel} / ${xLabel}`"
    data-verify-unit="plot-frame"
    data-verify-state="ready"
    @mousemove="onMove"
    @mouseleave="emit('plot-hover', null)"
  >
    <defs>
      <clipPath :id="clipId"><rect :width="innerW" :height="innerH" /></clipPath>
    </defs>
    <g :transform="`translate(${margin.left},${margin.top})`">
      <g class="grid" aria-hidden="true">
        <line v-for="t in yTicks" :key="`gy${t}`" :x1="0" :x2="innerW" :y1="yScale(t)" :y2="yScale(t)" />
      </g>
      <g class="axis" aria-hidden="true">
        <line :x1="0" :x2="innerW" :y1="innerH" :y2="innerH" />
        <line :x1="0" :x2="0" :y1="0" :y2="innerH" />
        <g v-for="t in xTicks" :key="`x${t}`" :transform="`translate(${xScale(t)},${innerH})`">
          <line y2="5" />
          <text y="19" text-anchor="middle">{{ fx(t) }}</text>
        </g>
        <g v-for="t in yTicks" :key="`y${t}`" :transform="`translate(0,${yScale(t)})`">
          <line x2="-5" />
          <text x="-9" dy="0.32em" text-anchor="end">{{ fy(t) }}</text>
        </g>
        <text class="axis-label" :x="innerW / 2" :y="innerH + 38" text-anchor="middle">{{ xLabel }}</text>
        <text class="axis-label" :transform="`translate(-42,${innerH / 2}) rotate(-90)`" text-anchor="middle">
          {{ yLabel }}
        </text>
      </g>
      <rect
        class="capture"
        :width="innerW"
        :height="innerH"
        @click="onClick"
        @contextmenu="onContext"
      />
      <g :clip-path="`url(#${clipId})`"><slot /></g>
    </g>
  </svg>
</template>

<style scoped>
.plot {
  width: 100%;
  height: auto;
  display: block;
  font-size: 12px;
}
.grid line {
  stroke: var(--grid);
}
.axis line {
  stroke: var(--axis);
}
.axis text {
  fill: var(--text-muted);
}
.axis .axis-label {
  fill: var(--text);
  font-size: 13px;
}
.capture {
  fill: transparent;
  cursor: crosshair;
}
</style>
