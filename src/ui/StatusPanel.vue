<script setup lang="ts">
import { useI18n } from '../i18n'

defineProps<{
  unit: string
  state: 'loading' | 'empty' | 'ready' | 'error'
  error?: string
  count?: number
}>()
const { t } = useI18n()
</script>

<template>
  <section
    class="status-panel"
    :data-verify-unit="unit"
    :data-verify-state="state"
    :data-verify-error="state === 'error' ? (error ?? '') : undefined"
    :data-verify-count="count"
  >
    <p v-if="state === 'loading'" class="msg" role="status">{{ t('status.loading') }}</p>
    <p v-else-if="state === 'empty'" class="msg">{{ t('status.empty') }}</p>
    <div v-else-if="state === 'error'" class="error-box" role="alert">
      <strong>{{ t('status.error') }}</strong>
      <span v-if="error"> {{ error }}</span>
    </div>
    <slot v-else />
  </section>
</template>

<style scoped>
.msg {
  color: var(--text-muted);
  margin: 0.5rem 0;
}
.error-box {
  border: 1px solid var(--error);
  border-left-width: 4px;
  background: var(--error-bg);
  color: var(--text);
  padding: 0.6rem 0.8rem;
  border-radius: 4px;
}
</style>
