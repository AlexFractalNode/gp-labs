<script setup lang="ts">
import { computed, inject, type ComputedRef } from 'vue'
import { PLOT_SCALES, type PlotScales } from '../../ui/plotScales'

/** Vertical guide at the inspected x* with the posterior mean and the ±2·s_f whisker. */
const props = defineProps<{ x: number; mean?: number; sdF?: number; pinned: boolean }>()
const scales = inject<ComputedRef<PlotScales>>(PLOT_SCALES)!

const px = computed(() => scales.value.x(props.x))
const yRange = computed(() => scales.value.y.range() as [number, number])
const has = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v)
</script>

<template>
  <g class="cursor" :class="{ pinned }" aria-hidden="true">
    <line class="guide" :x1="px" :x2="px" :y1="yRange[0]" :y2="yRange[1]" />
    <template v-if="has(mean)">
      <line
        v-if="has(sdF)"
        class="whisker"
        :x1="px"
        :x2="px"
        :y1="scales.y(mean - 2 * sdF)"
        :y2="scales.y(mean + 2 * sdF)"
      />
      <circle class="marker" :cx="px" :cy="scales.y(mean)" r="4.5" />
    </template>
  </g>
</template>

<style scoped>
.cursor {
  pointer-events: none;
}
.guide {
  stroke: var(--text-muted);
  stroke-width: 1;
  stroke-dasharray: 3 4;
  opacity: 0.7;
}
.pinned .guide {
  stroke: var(--focus);
  stroke-dasharray: none;
  opacity: 0.9;
}
.whisker {
  stroke: var(--c-mean);
  stroke-width: 3;
  stroke-linecap: round;
  opacity: 0.35;
}
.marker {
  fill: var(--surface);
  stroke: var(--c-mean);
  stroke-width: 2;
}
</style>
