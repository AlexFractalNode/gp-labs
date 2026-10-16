<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n, type MessageKey } from '../i18n'
import type { Scenario } from '../tools/scenarios'

/**
 * Explanation box of the active scenario. The box stays in the DOM (hidden when there is no scenario) but is no live
 * region: a hidden region is not in the accessibility tree, so un-hiding it and filling it in one render would go
 * unannounced, and an atomic box would be re-read on every deviation or language change. A permanent visually hidden
 * sibling announces only the title (plus the deviation hint while deviated).
 */
const props = defineProps<{ scenario: Scenario | null; deviated: boolean }>()
const emit = defineEmits<{ close: []; restore: [] }>()
const { t } = useI18n()

const key = (part: 'title' | 'see' | 'watch' | 'next') => `scenario.${props.scenario?.id}.${part}` as MessageKey
// The announcement is a snapshot: it changes only when the scenario or the deviation changes, never on a language
// toggle (the box text stays reactive).
const announcement = ref('')
watch(
  () => [props.scenario?.id ?? null, props.deviated] as const,
  () => {
    announcement.value =
      props.scenario === null ? '' : props.deviated ? `${t(key('title'))} ${t('scenario.changed')}` : t(key('title'))
  },
  { immediate: true },
)
const titleEl = ref<HTMLElement | null>(null)
/** Moves the focus to the title, e.g. after "restore" removed the button that held it. */
function focusTitle(): void {
  titleEl.value?.focus()
}
defineExpose({ focusTitle })
const sections = computed(() =>
  props.scenario === null
    ? []
    : [
        { label: t('scenario.noteSee'), text: t(key('see')) },
        { label: t('scenario.noteWatch'), text: t(key('watch')) },
        { label: t('scenario.noteNext'), text: t(key('next')) },
      ],
)
</script>

<template>
  <div class="scenario-note-wrap">
    <section
      class="scenario-note"
      data-verify-unit="scenario-note"
      :data-verify-state="scenario ? 'ready' : 'empty'"
      :data-verify-scenario="scenario?.id ?? ''"
      :data-verify-deviated="scenario !== null && deviated ? 'true' : 'false'"
      :hidden="scenario === null"
    >
      <div v-if="scenario" class="box">
        <button
          type="button"
          class="close"
          data-action="close"
          :aria-label="t('scenario.close')"
          @click="emit('close')"
        >
          <span aria-hidden="true">×</span>
        </button>
        <h3 ref="titleEl" class="note-title" tabindex="-1">{{ t(key('title')) }}</h3>
        <div class="sections">
          <div v-for="sec in sections" :key="sec.label" class="section">
            <h4>{{ sec.label }}</h4>
            <p>{{ sec.text }}</p>
          </div>
        </div>
        <p v-if="deviated" class="changed">
          <span>{{ t('scenario.changed') }}</span>
          <button type="button" class="restore" data-action="restore" @click="emit('restore')">
            {{ t('scenario.restore') }}
          </button>
        </p>
      </div>
    </section>
    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ announcement }}</p>
  </div>
</template>

<style scoped>
.box {
  position: relative;
  border: 1px solid var(--border);
  border-left: 4px solid var(--accent);
  background: var(--surface);
  color: var(--text);
  padding: 0.6rem 2.6rem 0.6rem 0.9rem;
  border-radius: 4px;
  margin: 0.6rem 0 0;
  overflow-wrap: anywhere;
}
.close {
  position: absolute;
  top: 0.35rem;
  right: 0.35rem;
  font: inherit;
  font-size: 1.2rem;
  line-height: 1;
  width: 2rem;
  height: 2rem;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.close:hover {
  border-color: var(--border);
  color: var(--text);
}
.note-title {
  outline-offset: 2px;
  margin: 0 0 0.4rem;
  font-size: 1.05rem;
}
.note-title:focus-visible {
  outline: 2px solid var(--focus);
}
.sections {
  display: grid;
  gap: 0.4rem 1rem;
}
@media (min-width: 960px) {
  .sections {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
h4 {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-muted);
}
.section p {
  margin: 0.15rem 0 0;
}
.changed {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin: 0.6rem 0 0;
  padding-top: 0.5rem;
  border-top: 1px solid var(--grid);
  color: var(--focus);
  font-weight: 600;
}
.restore {
  font: inherit;
  font-size: 0.85rem;
  font-weight: 400;
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
.restore:hover {
  border-color: var(--accent);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
