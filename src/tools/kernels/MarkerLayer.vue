<script setup lang="ts">
/** Vertical marker at x₀ with a dot at (x₀, k(x₀, x₀)) inside a PlotFrame. */
import { inject, type ComputedRef } from 'vue'
import { PLOT_SCALES, type PlotScales } from '../../ui/plotScales'

defineProps<{ x: number; y: number | null }>()
const scales = inject<ComputedRef<PlotScales>>(PLOT_SCALES)!
</script>

<template>
  <g class="marker" aria-hidden="true">
    <line :x1="scales.x(x)" :x2="scales.x(x)" :y1="scales.y.range()[0]" :y2="scales.y.range()[1]" />
    <circle v-if="y !== null && Number.isFinite(y)" :cx="scales.x(x)" :cy="scales.y(y)" r="4.5" />
  </g>
</template>

<style scoped>
.marker {
  pointer-events: none;
}
line {
  stroke: var(--focus);
  stroke-width: 1.5;
  stroke-dasharray: 5 4;
}
circle {
  fill: var(--focus);
  stroke: var(--surface);
  stroke-width: 1.5;
}
</style>
