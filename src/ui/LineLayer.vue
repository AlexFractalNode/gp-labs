<script setup lang="ts">
import { computed, inject, type ComputedRef } from 'vue'
import { line } from 'd3-shape'
import { PLOT_SCALES, type PlotScales, type Variant } from './plotScales'

const props = defineProps<{ x: ArrayLike<number>; y: ArrayLike<number>; variant: Variant }>()
const scales = inject<ComputedRef<PlotScales>>(PLOT_SCALES)!

const d = computed(() => {
  const idx = Array.from({ length: Math.min(props.x.length, props.y.length) }, (_, i) => i)
  const gen = line<number>()
    .x((i) => scales.value.x(props.x[i]))
    .y((i) => scales.value.y(props.y[i]))
    .defined((i) => Number.isFinite(props.y[i]))
  return gen(idx) ?? ''
})
</script>

<template>
  <g class="layer" :data-variant="variant">
    <path data-layer="line" :d="d" />
  </g>
</template>

<style scoped>
.layer {
  pointer-events: none;
}
path {
  fill: none;
  stroke: var(--v);
  stroke-width: 2;
  stroke-linejoin: round;
}
[data-variant='mean'] path {
  stroke-width: 2.6;
}
[data-variant='sample'] path {
  stroke-width: 1.3;
  stroke-opacity: 0.85;
}
[data-variant='truth'] path {
  stroke-dasharray: 7 4;
}
[data-variant='prior'] path {
  stroke-dasharray: 2 3;
}
</style>
