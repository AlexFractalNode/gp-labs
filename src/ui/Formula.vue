<script setup lang="ts">
import { computed } from 'vue'
import katex from 'katex'
import 'katex/dist/katex.min.css'

const props = withDefaults(defineProps<{ tex: string; display?: boolean }>(), { display: false })
const html = computed(() =>
  katex.renderToString(props.tex, { displayMode: props.display, throwOnError: false, output: 'htmlAndMathml' }),
)
</script>

<template>
  <!-- KaTeX output is generated from the TeX source; `trust` stays off (default). -->
  <span class="formula" :class="{ display }" v-html="html" />
</template>

<style scoped>
.formula.display {
  display: block;
  overflow-x: auto;
}
</style>
