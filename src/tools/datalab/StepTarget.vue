<script setup lang="ts">
/**
 * Step 2: target column, feature checkboxes and log(y). Text and constant columns cannot be features (listed with
 * the reason); rows with missing values are dropped by `prepareDataset` (count shown, with a note on imputation).
 */
import { computed, useId } from 'vue'
import { useI18n } from '../../i18n'
import type { ColumnInfo } from '../../core/csv'
import type { Dataset } from './pipeline'
import type { Problem } from './labState'

const props = defineProps<{
  info: ColumnInfo[]
  dataset: Dataset | null
  problem: Problem | null
  canLog: boolean
}>()
const target = defineModel<string>('target', { required: true })
const selected = defineModel<string[]>('selected', { required: true })
const logTarget = defineModel<boolean>('logTarget', { required: true })
const emit = defineEmits<{ next: [] }>()
const { t } = useI18n()
const id = useId()

const candidates = computed(() => props.info.filter((c) => c.name !== target.value))
const usable = (c: ColumnInfo) => c.type === 'numeric' && !c.constant
const excluded = computed(() => candidates.value.filter((c) => !usable(c)))

function toggle(name: string, on: boolean) {
  const rest = selected.value.filter((n) => n !== name)
  selected.value = on ? [...rest, name] : rest
}
</script>

<template>
  <div class="step-target">
    <div class="cols">
      <div>
        <label class="field-label" :for="`${id}-target`">{{ t('datalab.target.target') }}</label>
        <select :id="`${id}-target`" v-model="target" data-field="target">
          <option v-for="c in info" :key="c.name" :value="c.name" :disabled="c.type !== 'numeric'">{{ c.name }}</option>
        </select>

        <div class="log">
          <label class="check">
            <input
              v-model="logTarget"
              type="checkbox"
              data-field="log-target"
              :disabled="!canLog"
              :aria-describedby="`${id}-log-hint`"
            />
            <span>{{ t('datalab.target.log') }}</span>
          </label>
          <p :id="`${id}-log-hint`" class="muted small hint">
            {{ canLog ? t('datalab.target.logHint') : t('datalab.target.logDisabled', { target }) }}
          </p>
        </div>
      </div>

      <fieldset class="features">
        <legend class="field-label">{{ t('datalab.target.features') }}</legend>
        <div class="feature-grid">
          <label v-for="c in candidates" :key="c.name" class="check" :class="{ off: !usable(c) }">
            <input
              type="checkbox"
              :data-feature="c.name"
              :checked="usable(c) && selected.includes(c.name)"
              :disabled="!usable(c)"
              @change="toggle(c.name, ($event.target as HTMLInputElement).checked)"
            />
            <span>{{ c.name }}</span>
            <span v-if="!usable(c)" class="reason">
              {{ c.type === 'text' ? t('datalab.target.reasonText') : t('datalab.target.reasonConstant') }}
            </span>
          </label>
        </div>
      </fieldset>
    </div>

    <div v-if="excluded.length" class="note warn">
      <strong>{{ t('datalab.target.excludedTitle') }}:</strong>
      <ul class="plain">
        <li v-for="c in excluded" :key="c.name">
          {{
            c.type === 'text'
              ? t('datalab.target.excludedText', { name: c.name })
              : t('datalab.target.excludedConstant', { name: c.name })
          }}
        </li>
      </ul>
    </div>

    <p v-if="problem" class="error-box" role="alert">{{ t(problem.key, problem.vars) }}</p>
    <template v-else-if="dataset">
      <p class="note" :class="{ warn: dataset.droppedRows > 0 }">
        {{
          dataset.droppedRows > 0
            ? t('datalab.target.dropped', { n: dataset.droppedRows })
            : t('datalab.target.droppedNone')
        }}
        {{ t('datalab.target.rows', { n: dataset.X.rows }) }}
        <span v-if="dataset.droppedRows > 0" class="block">{{ t('datalab.target.missingNote') }}</span>
      </p>
    </template>

    <div class="actions">
      <button type="button" class="btn" data-action="next" :disabled="!dataset" @click="emit('next')">
        {{ t('datalab.next') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: 1.5rem;
  margin-top: 0.75rem;
}
.log {
  margin-top: 0.9rem;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  cursor: pointer;
}
.check.off {
  color: var(--text-muted);
  cursor: not-allowed;
}
.hint {
  margin: 0.3rem 0 0;
  max-width: 55ch;
}
.features {
  border: 0;
  margin: 0;
  padding: 0;
  min-width: 0;
}
.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
  gap: 0.4rem 1rem;
}
.reason {
  font-size: 0.72rem;
  padding: 0 0.4rem;
  border-radius: 999px;
  border: 1px solid var(--border);
}
.plain {
  margin: 0.25rem 0 0;
  padding-left: 1.1rem;
}
.block {
  display: block;
  margin-top: 0.25rem;
  color: var(--text-muted);
}
@media (max-width: 760px) {
  .cols {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
