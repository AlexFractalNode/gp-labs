/**
 * Whether the viewport is narrower than the help drawer breakpoint (< 768 px): there the drawer fills the screen and
 * behaves like a dialog. One shared, reactive flag; without `matchMedia` (tests, SSR) the viewport counts as wide.
 */
import { ref, type Ref } from 'vue'

export const DRAWER_BREAKPOINT = 768

const query =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(`(max-width: ${DRAWER_BREAKPOINT - 1}px)`)
    : null

const narrow: Ref<boolean> = ref(query?.matches ?? false)
query?.addEventListener('change', (e) => {
  narrow.value = e.matches
})

export function useNarrowViewport(): Ref<boolean> {
  return narrow
}
