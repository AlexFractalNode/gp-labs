<script setup lang="ts">
import { inject, onBeforeUnmount, ref, type ComputedRef } from 'vue'
import { useI18n } from '../i18n'
import { PLOT_SCALES, type PlotScales } from './plotScales'

const props = withDefaults(
  defineProps<{ x: ArrayLike<number>; y: ArrayLike<number>; editable?: boolean; label?: string }>(),
  { editable: true },
)
const emit = defineEmits<{
  'point-drag': [index: number, p: { x: number; y: number }]
  'point-remove': [index: number]
}>()
const scales = inject<ComputedRef<PlotScales>>(PLOT_SCALES)!
const { t } = useI18n()
const dragging = ref<number | null>(null)

const LONG_PRESS_MS = 500
const MOVE_TOLERANCE_PX = 6
let pressTimer: ReturnType<typeof setTimeout> | null = null
let pressStart = { x: 0, y: 0 }

function cancelPress() {
  if (pressTimer !== null) clearTimeout(pressTimer)
  pressTimer = null
}
onBeforeUnmount(cancelPress)

function onDown(i: number, e: PointerEvent) {
  if (!props.editable) return
  dragging.value = i
  const target = e.target as Element
  target.setPointerCapture?.(e.pointerId)
  // Touch and pen have no right-click: a long press removes the point.
  if (e.pointerType !== 'mouse') {
    cancelPress()
    pressStart = { x: e.clientX, y: e.clientY }
    pressTimer = setTimeout(() => {
      pressTimer = null
      dragging.value = null
      emit('point-remove', i)
    }, LONG_PRESS_MS)
  }
}
function onMove(i: number, e: PointerEvent) {
  if (dragging.value !== i) return
  if (pressTimer !== null) {
    if (Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) <= MOVE_TOLERANCE_PX) return
    cancelPress()
  }
  const p = scales.value.toData(e.clientX, e.clientY)
  if (p) emit('point-drag', i, p)
}
function onUp() {
  cancelPress()
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
    <g v-for="(xv, i) in Array.from(x)" :key="i">
      <!-- Transparent, larger hit target (touch); the visible dot follows. -->
      <circle
        data-layer="point"
        class="hit"
        :class="{ editable }"
        :cx="scales.x(xv)"
        :cy="scales.y(y[i])"
        r="12"
        :tabindex="editable ? 0 : undefined"
        :role="editable ? 'button' : undefined"
        :aria-label="`${label ?? t('plot.point')} ${i + 1}`"
        @pointerdown.stop="onDown(i, $event)"
        @pointermove="onMove(i, $event)"
        @pointerup="onUp"
        @pointercancel="onUp"
        @click.stop
        @contextmenu.prevent.stop="onContext(i)"
        @keydown="onKey(i, $event)"
      />
      <circle class="dot" :cx="scales.x(xv)" :cy="scales.y(y[i])" r="5" />
    </g>
  </g>
</template>

<style scoped>
.hit {
  fill: transparent;
  touch-action: none;
  outline: none;
}
.hit.editable {
  cursor: grab;
}
.dot {
  fill: var(--c-points);
  stroke: var(--bg);
  stroke-width: 1.5;
  pointer-events: none;
}
.hit:focus-visible + .dot {
  stroke: var(--focus);
  stroke-width: 3;
}
</style>
