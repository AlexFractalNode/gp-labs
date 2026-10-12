<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../i18n'

const props = defineProps<{ chapter: string; code?: string }>()
const { t } = useI18n()
const text = computed(() =>
  props.code
    ? t('ref.badge', { chapter: props.chapter, code: props.code })
    : t('ref.badgeNoCode', { chapter: props.chapter }),
)
</script>

<template>
  <span class="ref-badge">{{ text }}</span>
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
</style>
