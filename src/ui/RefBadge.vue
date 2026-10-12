<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../i18n'

const props = defineProps<{ chapter: string; code?: string }>()
const { t } = useI18n()

/**
 * The badge text as segments: the catalogue template (e.g. "Lehrbuch Kap. {chapter} · Notebook Code {code}") with
 * the chapter and code values as separate parts, so ranges like "87–94" can be kept on one line (nowrap).
 */
const parts = computed(() => {
  const template = props.code ? t('ref.badge') : t('ref.badgeNoCode')
  const values: Record<string, string> = { chapter: props.chapter, code: props.code ?? '' }
  return template
    .split(/(\{chapter\}|\{code\})/)
    .filter((s) => s !== '')
    .map((s) => {
      const name = s.slice(1, -1)
      return s.startsWith('{') && name in values ? { text: values[name], value: true } : { text: s, value: false }
    })
})
</script>

<template>
  <span class="ref-badge"
    ><template v-for="(p, i) in parts" :key="i"
      ><span v-if="p.value" class="nowrap">{{ p.text }}</span
      ><template v-else>{{ p.text }}</template></template
    ></span
  >
</template>

<style scoped>
.ref-badge {
  display: inline-block;
  padding: 0.1rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-muted);
  font-size: 0.8rem;
  letter-spacing: 0.02em;
}
/* Chapter and code ranges such as "87–94" never break at the dash. */
.nowrap {
  white-space: nowrap;
}
</style>
