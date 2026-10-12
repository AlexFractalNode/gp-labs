<script setup lang="ts">
/** Step 1: Yacht data or an own CSV (drag & drop or file dialog), preview with column type and missing count. */
import { computed, ref } from 'vue'
import { useI18n } from '../../i18n'
import type { ColumnInfo, Table } from '../../core/csv'
import type { PanelState, Problem } from './labState'

const props = defineProps<{
  state: PanelState
  problem: Problem | null
  name: string
  table: Table | null
  info: ColumnInfo[]
}>()
const emit = defineEmits<{ yacht: []; file: [f: File]; next: [] }>()
const { lang, t } = useI18n()

const PREVIEW_ROWS = 8
const dragging = ref(false)

function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (f) emit('file', f)
  input.value = ''
}
function onDrop(e: DragEvent) {
  dragging.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) emit('file', f)
}

const rows = computed(() => props.table?.rows.slice(0, PREVIEW_ROWS) ?? [])
const fmt = computed(() => new Intl.NumberFormat(lang.value, { maximumFractionDigits: 6 }))
const cell = (v: number | string | null) => (v === null ? '–' : typeof v === 'number' ? fmt.value.format(v) : v)
</script>

<template>
  <div class="step-data">
    <div class="sources">
      <div class="source">
        <button type="button" class="btn primary" data-action="load-yacht" @click="emit('yacht')">
          {{ t('datalab.data.yacht') }}
        </button>
        <p class="muted small">{{ t('datalab.data.yachtNote') }}</p>
      </div>
      <span class="or" aria-hidden="true">{{ t('datalab.data.or') }}</span>
      <label
        class="drop"
        :class="{ dragging }"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
      >
        <input
          type="file"
          class="sr-only"
          accept=".csv,.txt,.tsv,.data,text/csv,text/plain"
          data-field="csv-file"
          @change="onPick"
        />
        <span class="drop-title">{{ t('datalab.data.drop') }}</span>
        <span class="muted small">{{ t('datalab.data.dropHint') }}</span>
      </label>
    </div>
    <p class="note privacy">{{ t('datalab.data.privacy') }}</p>

    <section
      class="preview"
      data-verify-unit="datalab-preview"
      :data-verify-state="state"
      :data-verify-error="state === 'error' ? problem?.key : undefined"
      :data-verify-count="table ? table.rows.length : 0"
      :aria-busy="state === 'loading'"
    >
      <p v-if="state === 'loading'" class="muted" role="status">{{ t('datalab.data.loading') }}</p>
      <p v-else-if="state === 'error' && problem" class="error-box" role="alert">{{ t(problem.key, problem.vars) }}</p>
      <template v-if="table && state !== 'loading'">
        <h4 class="preview-title">
          {{ name }} · {{ t('datalab.data.preview', { n: rows.length, rows: table.rows.length }) }}
        </h4>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th v-for="c in info" :key="c.name" scope="col" :data-column-type="c.type">
                  <span class="col-name">{{ c.name }}</span>
                  <span class="col-meta" :class="c.type">
                    {{ c.type === 'numeric' ? t('datalab.data.numeric') : t('datalab.data.text') }} · {{ c.missing }}
                    {{ t('datalab.data.missing') }}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="i">
                <td v-for="(v, j) in r" :key="j" :class="{ num: typeof v === 'number', na: v === null }">{{ cell(v) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="actions">
          <button type="button" class="btn" data-action="next" @click="emit('next')">{{ t('datalab.next') }}</button>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.sources {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1.2fr);
  gap: 1rem;
  align-items: center;
  margin-top: 0.75rem;
}
.source p {
  margin: 0.5rem 0 0;
  max-width: 52ch;
}
.or {
  color: var(--text-muted);
  font-family: var(--serif);
  font-style: italic;
}
.drop {
  display: grid;
  gap: 0.3rem;
  justify-items: center;
  text-align: center;
  padding: 1.1rem 1rem;
  border: 2px dashed var(--border);
  border-radius: 6px;
  cursor: pointer;
  background: var(--bg);
  position: relative;
}
.drop:hover,
.drop.dragging {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 6%, var(--bg));
}
.drop:focus-within {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.drop-title {
  font-weight: 600;
}
.privacy {
  margin-top: 0.9rem;
}
.preview {
  margin-top: 1rem;
}
.preview-title {
  margin: 0 0 0.5rem;
  text-transform: none;
  letter-spacing: 0.02em;
  font-size: 0.85rem;
}
.table-wrap {
  /* Containing block for the sr-only header text, so it is clipped by the scroll box. */
  position: relative;
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.data-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}
.data-table th,
.data-table td {
  padding: 0.3rem 0.6rem;
  border-bottom: 1px solid var(--grid);
  text-align: right;
  white-space: nowrap;
}
.data-table th {
  background: var(--bg);
  vertical-align: bottom;
}
.col-name {
  display: block;
  font-weight: 650;
}
.col-meta {
  display: block;
  font-weight: 400;
  font-size: 0.72rem;
  color: var(--text-muted);
}
.col-meta.text {
  color: var(--c-y);
}
.data-table td.na {
  color: var(--text-muted);
}
.data-table td:not(.num) {
  text-align: left;
}
@media (max-width: 760px) {
  .sources {
    grid-template-columns: minmax(0, 1fr);
  }
  .or {
    justify-self: center;
  }
}
</style>
