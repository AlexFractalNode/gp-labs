<script setup lang="ts">
import { computed, inject, type ComputedRef } from 'vue'
import { area } from 'd3-shape'
import { PLOT_SCALES, type PlotScales, type Variant } from './plotScales'

const props = defineProps<{
  x: ArrayLike<number>
  lower: ArrayLike<number>
  upper: ArrayLike<number>
  variant: Variant
}>()
const scales = inject<ComputedRef<PlotScales>>(PLOT_SCALES)!
const hatchId = `hatch-${Math.random().toString(36).slice(2, 9)}`
// f: solid fill; y: hatched, so the two bands differ without relying on colour.
const hatched = computed(() => props.variant === 'y')

const d = computed(() => {
  const idx = Array.from({ length: props.x.length }, (_, i) => i)
  const gen = area<number>()
    .x((i) => scales.value.x(props.x[i]))
    .y0((i) => scales.value.y(props.lower[i]))
    .y1((i) => scales.value.y(props.upper[i]))
    .defined((i) => Number.isFinite(props.lower[i]) && Number.isFinite(props.upper[i]))
  return gen(idx) ?? ''
})
</script>

<template>
  <g class="layer" :data-variant="variant">
    <defs v-if="hatched">
      <pattern :id="hatchId" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" class="hatch" />
      </pattern>
    </defs>
    <path
      data-layer="band"
      :d="d"
      :class="hatched ? 'hatched' : 'solid'"
      :style="hatched ? { fill: `url(#${hatchId})` } : undefined"
    />
  </g>
</template>

<style scoped>
.layer {
  pointer-events: none;
}
.solid {
  fill: var(--v);
  fill-opacity: 0.22;
}
.hatched {
  stroke: var(--v);
  stroke-width: 1;
  stroke-opacity: 0.5;
}
.hatch {
  stroke: var(--v);
  stroke-width: 1.4;
}
</style>
