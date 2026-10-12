<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from './router'
import { useI18n, toggleLang, type MessageKey } from './i18n'
import { dismissNotice, notify, useNotices } from './notify'
import { buildHash, urlProblems, type Route } from './urlState'
import HomeView from './tools/home/HomeView.vue'
import PlaygroundView from './tools/playground/PlaygroundView.vue'
import KernelsView from './tools/kernels/KernelsView.vue'
import DataLabView from './tools/datalab/DataLabView.vue'

const { lang, t } = useI18n()
const current = useRoute()
const notices = useNotices()

const links: { route: Route; label: MessageKey }[] = [
  { route: 'home', label: 'nav.home' },
  { route: 'playground', label: 'nav.playground' },
  { route: 'kernels', label: 'nav.kernels' },
  { route: 'datalab', label: 'nav.datalab' },
]

const route = computed(() => current.value.route)

// Invalid URL input falls back to the default view and tells the user.
watch(
  current,
  (c) => {
    for (const key of urlProblems(c)) notify(key)
  },
  { immediate: true },
)

// Screen readers and hyphenation follow the UI language.
watch(
  lang,
  (l) => {
    document.documentElement.lang = l
  },
  { immediate: true },
)
</script>

<template>
  <div data-verify-unit="app-shell" data-verify-state="ready" :data-verify-route="route">
    <header class="app-head">
      <h1><a class="brand" :href="buildHash('home')">{{ t('app.title') }}</a></h1>
      <nav :aria-label="t('nav.label')">
        <a
          v-for="l in links"
          :key="l.route"
          :href="buildHash(l.route)"
          :aria-current="route === l.route ? 'page' : undefined"
          >{{ t(l.label) }}</a
        >
      </nav>
      <button
        type="button"
        class="lang"
        data-verify-unit="lang-toggle"
        :aria-label="t('lang.toggle')"
        @click="toggleLang"
      >
        {{ lang === 'de' ? 'EN' : 'DE' }}
      </button>
    </header>
    <section
      class="notices"
      data-verify-unit="notice-bar"
      :data-verify-state="notices.length ? 'ready' : 'empty'"
      :data-verify-count="notices.length"
      role="status"
    >
      <p v-for="n in notices" :key="n.id" class="notice">
        <span>{{ t(n.key, n.vars) }}</span>
        <button type="button" class="dismiss" :aria-label="t('notice.dismiss')" @click="dismissNotice(n.id)">
          ×
        </button>
      </p>
    </section>
    <main>
      <!-- The Daten-Lab keeps its data, settings and a running optimisation when another tool is opened. -->
      <KeepAlive include="DataLabView">
        <PlaygroundView v-if="route === 'playground'" />
        <KernelsView v-else-if="route === 'kernels'" />
        <DataLabView v-else-if="route === 'datalab'" />
        <HomeView v-else />
      </KeepAlive>
    </main>
  </div>
</template>

<style scoped>
.app-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1.5rem;
  padding: 0.5rem 1rem;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
h1 {
  margin: 0;
  font-family: var(--serif);
  font-size: 1.3rem;
  font-weight: 600;
}
.brand {
  color: var(--text);
  text-decoration: none;
}
.brand:hover {
  text-decoration: underline;
  text-underline-offset: 4px;
}
nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  flex: 1;
  min-width: 0;
}
nav a {
  padding: 0.45rem 0.7rem 0.35rem;
  border-bottom: 2px solid transparent;
  border-radius: 4px 4px 0 0;
  color: var(--text-muted);
  font-size: 0.95rem;
  text-decoration: none;
  white-space: nowrap;
}
nav a:hover {
  color: var(--text);
  border-bottom-color: var(--border);
}
/* The active tool is marked by weight and an underline bar, not only by colour. */
nav a[aria-current='page'] {
  color: var(--text);
  font-weight: 650;
  border-bottom-color: var(--accent);
}
.lang {
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 0.3rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}
.lang:hover {
  border-color: var(--accent);
}
.notices:not(:empty) {
  padding: 0.5rem 1rem 0;
}
.notice {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  max-width: 1320px;
  margin: 0 auto 0.4rem;
  padding: 0.45rem 0.6rem 0.45rem 0.8rem;
  border: 1px solid var(--border);
  border-left: 3px solid var(--focus);
  border-radius: 4px;
  background: var(--surface);
  font-size: 0.9rem;
}
.dismiss {
  flex: none;
  font: inherit;
  font-size: 1.1rem;
  line-height: 1;
  padding: 0.1rem 0.4rem;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.dismiss:hover {
  color: var(--text);
}

/* Narrow screens: title and language switch on the first row, the navigation below. */
@media (max-width: 640px) {
  h1 {
    flex: 1;
  }
  nav {
    order: 3;
    flex-basis: 100%;
    gap: 0;
  }
  nav a {
    padding-inline: 0.4rem;
    font-size: 0.9rem;
  }
}
</style>
