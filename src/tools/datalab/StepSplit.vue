<script setup lang="ts">
/**
 * Step 3: test fraction and seed of a random split, or the exact notebook split (Yacht with a1–a6 and target y).
 * Above LARGE_N training rows a warning offers a seeded subsample of LARGE_N training rows.
 */
import { computed, useId } from 'vue'
import { useI18n } from '../../i18n'
import LinearSlider from '../../ui/LinearSlider.vue'
import { LARGE_N, type Split } from './pipeline'

const props = defineProps<{ split: Split; baseTrain: number; notebookAvailable: boolean }>()
const testFraction = defineModel<number>('testFraction', { required: true })
const seed = defineModel<number>('seed', { required: true })
const notebookMode = defineModel<boolean>('notebookMode', { required: true })
const subsample = defineModel<boolean>('subsample', { required: true })
const emit = defineEmits<{ next: [] }>()
const { lang, t } = useI18n()
const id = useId()

const pct = computed(() => new Intl.NumberFormat(lang.value, { style: 'percent', maximumFractionDigits: 0 }))

function setFraction(v: number) {
  notebookMode.value = false
  testFraction.value = Math.min(0.5, Math.max(0.05, Math.round(v * 100) / 100))
}
function setSeed(e: Event) {
  const v = Math.floor(Number((e.target as HTMLInputElement).value))
  if (!Number.isFinite(v) || v < 0) return
  notebookMode.value = false
  seed.value = v
}
const large = computed(() => props.baseTrain > LARGE_N)
</script>

<template>
  <div
    class="step-split"
    data-verify-unit="datalab-split"
    data-verify-state="ready"
    :data-verify-mode="notebookMode ? 'notebook' : 'random'"
    :data-verify-count="split.train.length"
  >
    <div class="cols">
      <div class="controls">
        <LinearSlider
          :model-value="testFraction"
          :min="0.05"
          :max="0.5"
          :step="0.05"
          :label="`${t('datalab.split.fraction')} (${pct.format(testFraction)})`"
          @update:model-value="setFraction"
        />
        <div class="seed">
          <label class="field-label" :for="`${id}-seed`">{{ t('datalab.split.seed') }}</label>
          <input :id="`${id}-seed`" type="number" min="0" step="1" :value="seed" data-field="seed" @change="setSeed" />
        </div>
      </div>

      <div class="mode">
        <p class="counts tabular">
          <strong>{{ t('datalab.split.counts', { train: split.train.length, test: split.test.length }) }}</strong>
        </p>
        <p class="muted">
          <span v-if="notebookMode" class="tag">{{ t('datalab.split.notebookActive') }}</span>
          <span v-else>{{ t('datalab.split.random', { seed }) }}</span>
        </p>
        <template v-if="notebookAvailable">
          <button
            type="button"
            class="btn"
            data-action="notebook-split"
            :aria-pressed="notebookMode"
            :aria-describedby="`${id}-nb`"
            @click="notebookMode = true"
          >
            {{ t('datalab.split.notebook') }}
          </button>
          <p :id="`${id}-nb`" class="muted small hint">{{ t('datalab.split.notebookHint') }}</p>
        </template>
      </div>
    </div>

    <p class="note">{{ t('datalab.split.scaler') }}</p>

    <div v-if="large" class="note warn" role="status">
      <p class="tight">
        {{
          subsample
            ? t('datalab.split.subsampleActive', { max: LARGE_N, n: baseTrain })
            : t('datalab.split.largeN', { max: LARGE_N, n: baseTrain })
        }}
      </p>
      <button v-if="!subsample" type="button" class="btn" data-action="subsample" @click="subsample = true">
        {{ t('datalab.split.subsample', { max: LARGE_N }) }}
      </button>
      <button v-else type="button" class="btn" @click="subsample = false">{{ t('datalab.split.subsampleOff') }}</button>
    </div>

    <div class="actions">
      <button type="button" class="btn" data-action="next" @click="emit('next')">{{ t('datalab.next') }}</button>
    </div>
  </div>
</template>

<style scoped>
.cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1.5rem;
  margin-top: 0.75rem;
  align-items: start;
}
.seed {
  margin-top: 0.6rem;
}
.seed input {
  width: 8rem;
}
.counts {
  margin: 0.2rem 0 0.3rem;
  font-size: 1.05rem;
}
.mode p {
  margin: 0 0 0.5rem;
}
.hint {
  margin: 0.35rem 0 0;
  max-width: 55ch;
}
.tight {
  margin: 0 0 0.45rem;
}
@media (max-width: 760px) {
  .cols {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
