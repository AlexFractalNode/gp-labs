/**
 * Textbook chapters and notebook-cell numbers per tool, shown on the home cards and in the help drawer
 * (onboarding Spec §4; the values follow the learning goals in Spec §4–6).
 */
import type { ToolId } from './scenarios'

export const TOOL_REFS: Record<ToolId, { chapter: string; code: string }> = {
  playground: { chapter: '1, 6–8, 10–12', code: '17–48' },
  kernels: { chapter: '5, 8, 13', code: '53–70' },
  datalab: { chapter: '14, 15, 17', code: '87–94' },
}
