<script setup lang="ts">
import { computed, ref, useId } from 'vue'

const props = defineProps<{ modelValue: number; min: number; max: number; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: number] }>()

const lnMin = computed(() => Math.log(props.min))
const range = computed(() => Math.log(props.max) - Math.log(props.min))
const pos = computed(() => {
  const p = (Math.log(props.modelValue) - lnMin.value) / range.value
  return Math.min(Math.max(Number.isFinite(p) ? p : 0, 0), 1)
})
const text = computed(() => String(Number(props.modelValue.toPrecision(3))))
const labelId = useId()
const track = ref<HTMLElement | null>(null)
const active = ref(false)

function setPos(p: number) {
  const q = Math.min(Math.max(p, 0), 1)
  // Exact bounds at the ends, avoids exp/log round-off.
  const v = q === 0 ? props.min : q === 1 ? props.max : Math.exp(lnMin.value + q * range.value)
  emit('update:modelValue', v)
}
const KEY_STEP: Record<string, number> = {
  ArrowUp: 0.01,
  ArrowRight: 0.01,
  ArrowDown: -0.01,
  ArrowLeft: -0.01,
  PageUp: 0.1,
  PageDown: -0.1,
}
function onKey(e: KeyboardEvent) {
  if (e.key in KEY_STEP) {
    e.preventDefault()
    setPos(pos.value + KEY_STEP[e.key])
  } else if (e.key === 'Home') {
    e.preventDefault()
    setPos(0)
  } else if (e.key === 'End') {
    e.preventDefault()
    setPos(1)
  }
}
function fromPointer(e: PointerEvent) {
  const r = track.value?.getBoundingClientRect()
  if (!r || r.width === 0) return
  setPos((e.clientX - r.left) / r.width)
}
function onDown(e: PointerEvent) {
  active.value = true
  const target = e.currentTarget as Element
  target.setPointerCapture?.(e.pointerId)
  fromPointer(e)
}
function onMove(e: PointerEvent) {
  if (active.value) fromPointer(e)
}
</script>

<template>
  <div class="slider" data-slider="log">
    <div class="head">
      <span :id="labelId" class="label">{{ label }}</span>
      <output class="value">{{ text }}</output>
    </div>
    <div
      ref="track"
      class="track"
      role="slider"
      tabindex="0"
      :aria-labelledby="labelId"
      :aria-valuemin="min"
      :aria-valuemax="max"
      :aria-valuenow="modelValue"
      :aria-valuetext="text"
      @keydown="onKey"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="active = false"
      @pointercancel="active = false"
    >
      <span class="rail" />
      <span class="fill" :style="{ width: `${pos * 100}%` }" />
      <span class="thumb" :style="{ left: `${pos * 100}%` }" />
    </div>
  </div>
</template>

<style scoped>
.slider {
  margin: 0.4rem 0;
}
.head {
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
}
.value {
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}
.track {
  position: relative;
  height: 28px;
  cursor: pointer;
  touch-action: none;
  border-radius: 4px;
}
.track:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.rail,
.fill {
  position: absolute;
  top: 12px;
  left: 0;
  height: 4px;
  border-radius: 2px;
}
.rail {
  right: 0;
  background: var(--border);
}
.fill {
  background: var(--accent);
}
.thumb {
  position: absolute;
  top: 4px;
  width: 20px;
  height: 20px;
  margin-left: -10px;
  border-radius: 50%;
  background: var(--surface);
  border: 2px solid var(--accent);
  box-sizing: border-box;
}
</style>
