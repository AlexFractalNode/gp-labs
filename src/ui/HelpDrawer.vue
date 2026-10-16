<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n, type MessageKey } from '../i18n'
import { HELP_TOPICS } from '../tools/helpTopics'
import { scenarioHref, scenariosFor, type Scenario, type ToolId } from '../tools/scenarios'
import { TOOL_REFS } from '../tools/toolRefs'
import { applyScenario } from '../tools/useScenario'
import RefBadge from './RefBadge.vue'
import { useNarrowViewport } from './viewport'

/**
 * Non-modal help drawer of the open tool (onboarding, Spec §4): purpose, how to read each panel, what each control
 * does, the course reference and the tool's scenarios. Closed, it stays in the DOM (`hidden`, contract `empty`).
 * Escape closes it only while the focus is inside (the listener sits on the drawer itself). Below 768 px it fills the
 * screen and a scenario link closes it, so the result is visible; on wide screens it stays open.
 */
const props = defineProps<{ tool: ToolId | null; open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { lang, t } = useI18n()
const narrow = useNarrowViewport()

const root = ref<HTMLElement | null>(null)
const headingEl = ref<HTMLElement | null>(null)

const visible = computed(() => props.open && props.tool !== null)
const topics = computed(() => (props.tool ? HELP_TOPICS[props.tool] : null))
const scenarios = computed(() => (props.tool ? scenariosFor(props.tool) : []))
const toolName = computed(() => (props.tool ? t(`nav.${props.tool}` as MessageKey) : ''))
const text = (part: 'purpose' | `read.${string}` | `controls.${string}`) => t(`help.${props.tool}.${part}` as MessageKey)

// Opening moves the focus to the heading (the drawer is not a focus trap); a fresh tool starts at the top.
watch(visible, async (v) => {
  if (!v) return
  await nextTick()
  headingEl.value?.focus()
})
watch(
  () => props.tool,
  () => {
    if (root.value) root.value.scrollTop = 0
  },
)

function onScenario(s: Scenario): void {
  applyScenario(s)
  if (narrow.value) emit('close')
}
</script>

<template>
  <aside
    id="help-drawer"
    ref="root"
    class="help"
    :class="{ narrow }"
    :hidden="!visible"
    :aria-labelledby="visible ? 'help-title' : undefined"
    data-verify-unit="help"
    :data-verify-state="visible ? 'ready' : 'empty'"
    :data-verify-tool="tool ?? undefined"
    @keydown.esc="emit('close')"
  >
    <template v-if="visible && topics && tool">
      <header class="bar">
        <h2 id="help-title" ref="headingEl" tabindex="-1">{{ t('help.heading', { tool: toolName }) }}</h2>
        <button type="button" class="x" data-action="help-close" :aria-label="t('help.close')" @click="emit('close')">
          ×
        </button>
      </header>

      <div class="body">
        <section data-help="purpose" aria-labelledby="help-purpose-title">
          <h3 id="help-purpose-title" class="label">{{ t('help.purposeTitle') }}</h3>
          <p class="lead">{{ text('purpose') }}</p>
        </section>

        <section data-help="read" aria-labelledby="help-read-title">
          <h3 id="help-read-title" class="label">{{ t('help.readTitle') }}</h3>
          <ul class="rows">
            <li v-for="r in topics.read" :key="r.key" :data-help-key="r.key">
              <strong>{{ t(r.title, r.vars) }}</strong>
              <span>{{ text(`read.${r.key}`) }}</span>
            </li>
          </ul>
        </section>

        <section data-help="controls" aria-labelledby="help-controls-title">
          <h3 id="help-controls-title" class="label">{{ t('help.controlsTitle') }}</h3>
          <ul class="rows">
            <li v-for="c in topics.controls" :key="c.key" :data-help-key="c.key">
              <strong>{{ typeof c.label === 'string' ? t(c.label, c.vars) : c.label.literal }}</strong>
              <span>{{ text(`controls.${c.key}`) }}</span>
            </li>
          </ul>
        </section>

        <section data-help="course" aria-labelledby="help-course-title">
          <h3 id="help-course-title" class="label">{{ t('help.courseTitle') }}</h3>
          <RefBadge :chapter="TOOL_REFS[tool].chapter" :code="TOOL_REFS[tool].code" />
        </section>

        <section data-help="scenarios" aria-labelledby="help-scenarios-title">
          <h3 id="help-scenarios-title" class="label">{{ t('help.scenariosTitle') }}</h3>
          <p class="hint">{{ t('help.scenariosHint') }}</p>
          <ul class="links">
            <li v-for="s in scenarios" :key="s.id">
              <a
                :href="scenarioHref(s, lang)"
                :data-help-scenario="s.id"
                @click.prevent="onScenario(s)"
                >{{ t(`scenario.${s.id}.title` as MessageKey) }}</a
              >
            </li>
          </ul>
        </section>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.help {
  position: fixed;
  z-index: 30;
  top: var(--help-top, 3rem);
  right: 0;
  width: 360px;
  max-width: 100%;
  height: calc(100dvh - var(--help-top, 3rem));
  box-sizing: border-box;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--surface);
  border-left: 1px solid var(--border);
  box-shadow: -6px 0 14px -10px rgb(0 0 0 / 0.35);
}
/* `display` rules below must not undo the hidden attribute. */
.help[hidden] {
  display: none;
}
/* Below 768 px the drawer takes the whole screen, header included, and acts like a dialog. */
.help.narrow {
  top: 0;
  width: 100%;
  height: 100dvh;
  border-left: 0;
  box-shadow: none;
}

.bar {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem 0.6rem 1rem;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
h2 {
  margin: 0;
  font-family: var(--serif);
  font-size: 1.15rem;
  font-weight: 600;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
h2:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 3px;
  border-radius: 2px;
}
.x {
  flex: none;
  width: 2.25rem;
  height: 2.25rem;
  font: inherit;
  font-size: 1.5rem;
  line-height: 1;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}
.x:hover {
  border-color: var(--accent);
}

.body {
  display: grid;
  gap: 1.25rem;
  padding: 1rem 1rem 1.5rem;
}
.label {
  margin: 0 0 0.45rem;
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
p {
  margin: 0;
}
.lead {
  line-height: 1.55;
}
.hint {
  margin-bottom: 0.4rem;
  font-size: 0.88rem;
  line-height: 1.5;
  color: var(--text-muted);
}

/* Name above its explanation; a hairline separates the entries. */
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
}
.rows li {
  display: grid;
  gap: 0.15rem;
  padding: 0.55rem 0;
  border-top: 1px solid var(--grid);
  font-size: 0.9rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.rows li:first-child {
  border-top: 0;
  padding-top: 0;
}
.rows strong {
  font-weight: 650;
}
.rows span {
  color: var(--text-muted);
}

.help :deep(.ref-badge) {
  border-radius: 6px;
  line-height: 1.5;
}

.links {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.3rem;
}
.links a {
  display: block;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  text-decoration: none;
  font-weight: 600;
  font-size: 0.92rem;
}
.links a:hover {
  border-color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>
