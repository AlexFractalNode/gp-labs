import { ref, type Ref } from 'vue'
import type { MessageKey } from './i18n'

export interface Notice {
  id: number
  key: MessageKey
  vars?: Record<string, string | number>
}

const notices: Ref<Notice[]> = ref([])
let nextId = 1

export function notify(key: MessageKey, vars?: Record<string, string | number>): void {
  if (notices.value.some((n) => n.key === key)) return
  notices.value.push({ id: nextId++, key, vars })
}

export function dismissNotice(id: number): void {
  notices.value = notices.value.filter((n) => n.id !== id)
}

export function useNotices(): Ref<Notice[]> {
  return notices
}
