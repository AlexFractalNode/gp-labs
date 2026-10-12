<script setup lang="ts">
/**
 * Step 4: kernel template (plus the Kernel-Baukasten kernel from the URL), restarts, start / cancel and progress.
 * `datalab-run`: empty before the first run, loading while optimising, ready after success, error (with the
 * message) after a failure or cancel.
 */
import { computed, useId } from 'vue'
import { useI18n, type MessageKey } from '../../i18n'
import Formula from '../../ui/Formula.vue'
import LinearSlider from '../../ui/LinearSlider.vue'
import { TEMPLATE_IDS } from './templates'
import type { ModelPreview, RunView, TemplateChoice } from './labState'

const props = defineProps<{
  baukastenAvailable: boolean
  ardBlocked: boolean
  maxArd: number
  preview: ModelPreview | null
  run: RunView
  canStart: boolean
}>()
const template = defineModel<TemplateChoice>('template', { required: true })
const restarts = defineModel<number>('restarts', { required: true })
const emit = defineEmits<{ start: []; cancel: [] }>()
const { lang, t } = useI18n()
const id = useId()

const choices = computed<TemplateChoice[]>(() => (props.baukastenAvailable ? [...TEMPLATE_IDS, 'baukasten'] : [...TEMPLATE_IDS]))
const isArd = (c: TemplateChoice) => c.startsWith('ard-')
const lml = computed(() => new Intl.NumberFormat(lang.value, { maximumFractionDigits: 2 }))
const running = computed(() => props.run.state === 'loading')
</script>

<template>
  <div class="step-model">
    <div class="cols">
      <div>
        <label class="field-label" :for="`${id}-tpl`">{{ t('datalab.model.template') }}</label>
        <select :id="`${id}-tpl`" v-model="template" data-field="template">
          <option v-for="c in choices" :key="c" :value="c" :disabled="ardBlocked && isArd(c)">
            {{ t(`datalab.template.${c}` as MessageKey) }}
          </option>
        </select>
        <p v-if="ardBlocked" class="muted small hint">{{ t('datalab.error.tooManyFeaturesForArd', { max: maxArd }) }}</p>
        <p class="muted small hint">{{ t('datalab.model.noise') }}</p>

        <div v-if="preview?.tex" class="formula-box" :aria-label="t('datalab.model.formula')">
          <span class="field-label">{{ t('datalab.model.formula') }}</span>
          <Formula :tex="preview.tex" display />
        </div>
        <div v-if="template === 'baukasten'" class="note">
          <strong>{{ t('datalab.model.baukastenTitle') }}</strong>
          <ul class="plain">
            <li>{{ t('datalab.model.isotropic') }}</li>
            <li v-for="n in preview?.notices ?? []" :key="n">{{ t(`datalab.baukasten.${n}`) }}</li>
          </ul>
        </div>
        <p v-if="preview?.problem" class="error-box" role="alert">{{ t(preview.problem.key, preview.problem.vars) }}</p>
      </div>

      <div>
        <LinearSlider
          :model-value="restarts"
          :min="0"
          :max="10"
          :step="1"
          :label="t('datalab.model.restarts')"
          @update:model-value="restarts = Math.round($event)"
        />
        <p class="muted small hint">{{ t('datalab.model.restartsHint', { restarts, runs: restarts + 1 }) }}</p>

        <section
          class="run"
          data-verify-unit="datalab-run"
          :data-verify-state="run.state"
          :data-verify-error="run.state === 'error' ? run.problem?.key : undefined"
          :aria-busy="running"
        >
          <div class="actions">
            <button type="button" class="btn primary" data-action="start-run" :disabled="!canStart" @click="emit('start')">
              {{ t('datalab.model.start') }}
            </button>
            <button v-if="running" type="button" class="btn" data-action="cancel-run" @click="emit('cancel')">
              {{ t('datalab.model.cancel') }}
            </button>
          </div>
          <div v-if="running" class="progress" role="status">
            <progress :max="run.total" :value="run.run" :aria-label="t('datalab.model.progressLabel')" />
            <span class="muted tabular">
              {{ t('datalab.model.progress', { run: Math.min(run.run + 1, run.total), total: run.total }) }}
              <template v-if="Number.isFinite(run.best)"> · {{ t('datalab.model.progressBest', { lml: lml.format(run.best) }) }}</template>
            </span>
          </div>
          <p v-else-if="run.state === 'error' && run.problem" class="error-box" role="alert">
            {{ t(run.problem.key, run.problem.vars) }}
          </p>
          <p v-else-if="run.state === 'ready'" class="muted" role="status">
            {{ t('datalab.model.done', { id: run.lastId, lml: lml.format(run.lastLogML) }) }}
          </p>
          <p v-else class="muted">{{ t('datalab.model.idle') }}</p>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cols {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  gap: 1.5rem;
  margin-top: 0.75rem;
  align-items: start;
}
.hint {
  margin: 0.35rem 0 0;
  max-width: 60ch;
}
.formula-box {
  margin-top: 0.9rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--grid);
  border-radius: 4px;
  background: var(--bg);
  font-size: 0.9rem;
  overflow-x: auto;
}
.plain {
  margin: 0.25rem 0 0;
  padding-left: 1.1rem;
}
.run {
  margin-top: 0.4rem;
}
.progress {
  display: grid;
  gap: 0.3rem;
  margin-top: 0.75rem;
}
progress {
  width: 100%;
  height: 0.6rem;
  accent-color: var(--accent);
}
.run p {
  margin: 0.75rem 0 0;
}
@media (max-width: 760px) {
  .cols {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
