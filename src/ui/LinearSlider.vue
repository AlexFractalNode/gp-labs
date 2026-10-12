<script setup lang="ts">
import { useId } from 'vue'

defineProps<{ modelValue: number; min: number; max: number; step: number; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: number] }>()
const id = useId()

function onInput(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  if (Number.isFinite(v)) emit('update:modelValue', v)
}
</script>

<template>
  <div class="slider" data-slider="linear">
    <div class="head">
      <label :for="id" class="label">{{ label }}</label>
      <output :for="id" class="value">{{ modelValue }}</output>
    </div>
    <input :id="id" type="range" :min="min" :max="max" :step="step" :value="modelValue" @input="onInput" />
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
input {
  width: 100%;
  accent-color: var(--accent);
}
input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
</style>
