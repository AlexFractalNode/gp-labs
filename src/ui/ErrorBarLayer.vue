<script setup lang="ts">
import { inject, type ComputedRef } from 'vue'
import { PLOT_SCALES, type PlotScales, type Variant } from './plotScales'

withDefaults(
  defineProps<{
    x: ArrayLike<number>
    lower: ArrayLike<number>
    upper: ArrayLike<number>
    variant?: Variant
  }>(),
  { variant: 'y' },
)
const scales = inject<ComputedRef<PlotScales>>(PLOT_SCALES)!
</script>

<template>
  <g class="layer" :data-variant="variant">
    <g v-for="(xv, i) in Array.from(x)" :key="i" data-layer="errorbar">
      <line :x1="scales.x(xv)" :x2="scales.x(xv)" :y1="scales.y(lower[i])" :y2="scales.y(upper[i])" />
      <line :x1="scales.x(xv) - 3" :x2="scales.x(xv) + 3" :y1="scales.y(lower[i])" :y2="scales.y(lower[i])" />
      <line :x1="scales.x(xv) - 3" :x2="scales.x(xv) + 3" :y1="scales.y(upper[i])" :y2="scales.y(upper[i])" />
    </g>
  </g>
</template>

<style scoped>
.layer {
  pointer-events: none;
}
line {
  stroke: var(--v);
  stroke-width: 1.4;
}
</style>
