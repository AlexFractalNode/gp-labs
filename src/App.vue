<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from './router'
import { useI18n, setLang, type MessageKey } from './i18n'
import { dismissNotice, notify, useNotices } from './notify'
import { buildHash, urlProblems, type Route } from './urlState'
import PlaygroundView from './tools/playground/PlaygroundView.vue'

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

function toggleLang() {
  setLang(lang.value === 'de' ? 'en' : 'de')
}
</script>

<template>
  <div data-verify-unit="app-shell" data-verify-state="ready" :data-verify-route="route">
    <header>
      <h1>{{ t('app.title') }}</h1>
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
        data-verify-unit="lang-toggle"
        :aria-label="t('lang.toggle')"
        @click="toggleLang"
      >
        {{ lang === 'de' ? 'EN' : 'DE' }}
      </button>
    </header>
    <section
      data-verify-unit="notice-bar"
      :data-verify-state="notices.length ? 'ready' : 'empty'"
      :data-verify-count="notices.length"
      role="status"
    >
      <p v-for="n in notices" :key="n.id">
        {{ t(n.key, n.vars) }}
        <button type="button" :aria-label="t('notice.dismiss')" @click="dismissNotice(n.id)">
          ×
        </button>
      </p>
    </section>
    <main>
      <PlaygroundView v-if="route === 'playground'" />
      <p v-else>{{ t('home.placeholder') }}</p>
    </main>
  </div>
</template>

<style scoped>
header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 1rem;
}
h1 {
  font-size: 1.25rem;
  margin: 0;
}
nav {
  display: flex;
  gap: 0.75rem;
  flex: 1;
}
nav a[aria-current='page'] {
  font-weight: 700;
}
</style>
