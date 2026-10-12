<script setup lang="ts">
import { inject, ref, type ComputedRef } from 'vue'
import { PLOT_SCALES, type PlotScales } from './plotScales'

const props = withDefaults(
  defineProps<{ x: ArrayLike<number>; y: ArrayLike<number>; editable?: boolean; label?: string }>(),
  { editable: true, label: 'Point' },
)
const emit = defineEmits<{
  'point-drag': [index: number, p: { x: number; y: number }]
  'point-remove': [index: number]
}>()
const scales = inject<ComputedRef<PlotScales>>(PLOT_SCALES)!
const dragging = ref<number | null>(null)

function onDown(i: number, e: PointerEvent) {
  if (!props.editable) return
  dragging.value = i
  const target = e.target as Element
  target.setPointerCapture?.(e.pointerId)
}
function onMove(i: number, e: PointerEvent) {
  if (dragging.value !== i) return
  const p = scales.value.toData(e.clientX, e.clientY)
  if (p) emit('point-drag', i, p)
}
function onUp() {
  dragging.value = null
}
function onKey(i: number, e: KeyboardEvent) {
  if (!props.editable) return
  const [x0, x1] = scales.value.x.domain()
  const [y0, y1] = scales.value.y.domain()
  const dx = (x1 - x0) / 100
  const dy = (y1 - y0) / 100
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-dx, 0],
    ArrowRight: [dx, 0],
    ArrowUp: [0, dy],
    ArrowDown: [0, -dy],
  }
  if (e.key in moves) {
    e.preventDefault()
    emit('point-drag', i, { x: props.x[i] + moves[e.key][0], y: props.y[i] + moves[e.key][1] })
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault()
    emit('point-remove', i)
  }
}
function onContext(i: number) {
  if (props.editable) emit('point-remove', i)
}
</script>

<template>
  <g data-variant="points">
    <circle
      v-for="(xv, i) in Array.from(x)"
      :key="i"
      data-layer="point"
      :class="{ editable }"
      :cx="scales.x(xv)"
      :cy="scales.y(y[i])"
      r="5"
      :tabindex="editable ? 0 : undefined"
      :role="editable ? 'button' : undefined"
      :aria-label="`${label} ${i + 1}`"
      @pointerdown.stop="onDown(i, $event)"
      @pointermove="onMove(i, $event)"
      @pointerup="onUp"
      @pointercancel="onUp"
      @click.stop
      @contextmenu.prevent.stop="onContext(i)"
      @keydown="onKey(i, $event)"
    />
  </g>
</template>

<style scoped>
circle {
  fill: var(--c-points);
  stroke: var(--bg);
  stroke-width: 1.5;
}
circle.editable {
  cursor: grab;
}
circle:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
</style>
