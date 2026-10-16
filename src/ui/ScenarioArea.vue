<script setup lang="ts">
import { nextTick, ref } from 'vue'
import type { ScenarioApi } from '../tools/useScenario'
import type { ToolId } from '../tools/scenarios'
import ScenarioBar from './ScenarioBar.vue'
import ScenarioNote from './ScenarioNote.vue'

/**
 * Scenario bar plus note of one tool view. Both stay presentational; this wrapper only moves the keyboard focus when
 * the control that held it disappears: after closing the note it goes to the card of that scenario in the bar, after
 * "restore" (the button vanishes once the state matches again) to the note title.
 */
const props = defineProps<{ tool: ToolId; scenario: ScenarioApi }>()
const bar = ref<InstanceType<typeof ScenarioBar> | null>(null)
const note = ref<InstanceType<typeof ScenarioNote> | null>(null)

async function onClose(): Promise<void> {
  const id = props.scenario.active.value?.id ?? null
  props.scenario.dismiss()
  await nextTick()
  bar.value?.focusCard(id)
}

async function onRestore(): Promise<void> {
  props.scenario.restore()
  await nextTick()
  note.value?.focusTitle()
}
</script>

<template>
  <div class="scenario-area">
    <ScenarioBar ref="bar" :tool="tool" :active-id="scenario.active.value?.id ?? null" @apply="scenario.apply" />
    <ScenarioNote
      ref="note"
      :scenario="scenario.active.value"
      :deviated="scenario.deviated.value"
      @close="onClose"
      @restore="onRestore"
    />
  </div>
</template>
