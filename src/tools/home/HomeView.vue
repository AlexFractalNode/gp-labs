<script setup lang="ts">
import { useI18n, type MessageKey } from '../../i18n'
import { buildHash, type Route } from '../../urlState'
import RefBadge from '../../ui/RefBadge.vue'
import { TOOL_REFS } from '../toolRefs'

const { t } = useI18n()

interface ToolCard {
  route: Exclude<Route, 'home'>
  name: MessageKey
  summary: MessageKey
  goal: MessageKey
  /** Optional deep link into a preset, shown as a secondary link. */
  example?: { label: MessageKey; params: Record<string, string> }
}

// Chapter and notebook references (TOOL_REFS) follow the learning goals in Spec §4–6.
const TOOLS: ToolCard[] = [
  {
    route: 'playground',
    name: 'nav.playground',
    summary: 'home.tool.playground.summary',
    goal: 'home.tool.playground.goal',
    example: { label: 'home.tool.playground.example', params: { preset: 'kap9', x: '0' } },
  },
  {
    route: 'kernels',
    name: 'nav.kernels',
    summary: 'home.tool.kernels.summary',
    goal: 'home.tool.kernels.goal',
    example: { label: 'home.tool.kernels.example', params: { preset: 'power-exp' } },
  },
  {
    route: 'datalab',
    name: 'nav.datalab',
    summary: 'home.tool.datalab.summary',
    goal: 'home.tool.datalab.goal',
  },
]

// Roadmap R1–R7 (Spec §10). `chapter` is null where the item has no textbook chapter, 'all' for every chapter.
const ROADMAP: { id: string; chapter: string | null }[] = [
  { id: 'r1', chapter: '4–5' },
  { id: 'r2', chapter: '9–10' },
  { id: 'r3', chapter: '12' },
  { id: 'r4', chapter: '16' },
  { id: 'r5', chapter: 'all' },
  { id: 'r6', chapter: null },
  { id: 'r7', chapter: null },
]

const roadmapKey = (id: string, field: 'name' | 'desc') => `home.roadmap.${id}.${field}` as MessageKey
const chapterText = (chapter: string) =>
  chapter === 'all' ? t('home.allChapters') : t('home.chapters', { chapter })
</script>

<template>
  <div class="home" data-verify-unit="home" data-verify-state="ready">
    <header class="home-head">
      <h2 class="title">
        {{ t('home.titleLead') }} <cite>{{ t('home.work') }}</cite>
      </h2>
      <p class="lead">{{ t('home.lead') }}</p>
    </header>

    <section aria-labelledby="home-tools-title">
      <h3 id="home-tools-title" class="section-label">{{ t('home.toolsTitle') }}</h3>
      <ul class="cards" data-verify-unit="home-tools" data-verify-state="ready" :data-verify-count="TOOLS.length">
        <li v-for="(tool, i) in TOOLS" :key="tool.route" class="card" :data-tool="tool.route">
          <div class="card-top">
            <span class="ordinal" aria-hidden="true">{{ String(i + 1).padStart(2, '0') }}</span>
            <h4 class="card-title">{{ t(tool.name) }}</h4>
          </div>
          <p class="summary">{{ t(tool.summary) }}</p>
          <p class="goal">
            <span class="goal-label">{{ t('home.goal') }}</span>
            {{ t(tool.goal) }}
          </p>
          <RefBadge :chapter="TOOL_REFS[tool.route].chapter" :code="TOOL_REFS[tool.route].code" />
          <div class="card-actions">
            <a class="open" :href="buildHash(tool.route)">{{ t('home.open', { tool: t(tool.name) }) }}</a>
            <a v-if="tool.example" class="example" :href="buildHash(tool.route, tool.example.params)">
              {{ t('home.example', { name: t(tool.example.label) }) }}
            </a>
          </div>
        </li>
      </ul>
    </section>

    <section class="roadmap" aria-labelledby="home-roadmap-title">
      <h3 id="home-roadmap-title" class="section-title">{{ t('home.roadmapTitle') }}</h3>
      <p class="muted">{{ t('home.roadmapLead') }}</p>
      <ol data-verify-unit="home-roadmap" data-verify-state="ready" :data-verify-count="ROADMAP.length">
        <li v-for="item in ROADMAP" :key="item.id">
          <span class="rid">{{ item.id.toUpperCase() }}</span>
          <div>
            <p class="r-name">
              {{ t(roadmapKey(item.id, 'name')) }}
              <span v-if="item.chapter" class="r-chapter">{{ chapterText(item.chapter) }}</span>
            </p>
            <p class="r-desc">{{ t(roadmapKey(item.id, 'desc')) }}</p>
          </div>
        </li>
      </ol>
    </section>

    <footer class="fine">
      <section aria-labelledby="home-data-title">
        <h3 id="home-data-title" class="section-label">{{ t('home.dataTitle') }}</h3>
        <p>{{ t('home.data') }}</p>
      </section>
      <section aria-labelledby="home-notice-title">
        <h3 id="home-notice-title" class="section-label">{{ t('home.noticeTitle') }}</h3>
        <p>{{ t('home.notice') }}</p>
      </section>
    </footer>
  </div>
</template>

<style scoped>
.home {
  max-width: 1120px;
  margin: 0 auto;
  display: grid;
  gap: 2rem;
  padding-bottom: 1rem;
}
.home-head {
  padding: 1rem 0 1.25rem;
  border-bottom: 1px solid var(--border);
}
.title {
  margin: 0;
  max-width: 34ch;
  font-family: var(--serif);
  font-size: clamp(1.6rem, 1.2rem + 1.6vw, 2.35rem);
  font-weight: 600;
  line-height: 1.2;
  text-wrap: balance;
}
.title cite {
  font-style: italic;
}
.lead {
  margin: 0.75rem 0 0;
  max-width: 64ch;
  color: var(--text-muted);
  line-height: 1.55;
}
.section-label {
  margin: 0 0 0.6rem;
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.section-title {
  margin: 0;
  font-family: var(--serif);
  font-size: 1.35rem;
  font-weight: 600;
}

/* Tool cards */
.cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
  gap: 1rem;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 1.1rem 1.2rem 1.2rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-top: 3px solid var(--accent);
  border-radius: 6px;
  min-width: 0;
}
.card-top {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}
.ordinal {
  font-family: var(--serif);
  font-size: 0.95rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.card-title {
  margin: 0;
  font-family: var(--serif);
  font-size: 1.3rem;
  font-weight: 600;
}
.summary,
.goal {
  margin: 0;
  line-height: 1.5;
}
.goal {
  font-size: 0.92rem;
  color: var(--text-muted);
}
.goal-label {
  display: block;
  margin-bottom: 0.15rem;
  font-size: 0.72rem;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.card :deep(.ref-badge) {
  align-self: flex-start;
  border-radius: 6px;
}
.card-actions {
  margin-top: auto;
  padding-top: 0.3rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
}
.open {
  display: inline-block;
  padding: 0.4rem 0.9rem;
  border-radius: 4px;
  background: var(--accent);
  color: var(--surface);
  font-weight: 600;
  font-size: 0.9rem;
  text-decoration: none;
}
.open:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.example {
  font-size: 0.88rem;
  text-underline-offset: 3px;
}

/* Roadmap */
.roadmap {
  display: grid;
  gap: 0.4rem;
}
.roadmap .muted {
  margin: 0 0 0.4rem;
  color: var(--text-muted);
}
.roadmap ol {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 330px), 1fr));
  gap: 0 2rem;
}
.roadmap li {
  display: grid;
  grid-template-columns: 2.6rem minmax(0, 1fr);
  gap: 0.6rem;
  padding: 0.7rem 0;
  border-top: 1px solid var(--grid);
}
.rid {
  font-family: var(--serif);
  font-weight: 600;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}
.r-name {
  margin: 0;
  font-weight: 600;
}
.r-chapter {
  margin-left: 0.4rem;
  font-weight: 400;
  font-size: 0.8rem;
  color: var(--text-muted);
  white-space: nowrap;
}
.r-desc {
  margin: 0.2rem 0 0;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--text-muted);
}

/* Data credit and notice */
.fine {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 330px), 1fr));
  gap: 1rem 2rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--border);
}
.fine p {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
