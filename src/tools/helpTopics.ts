/**
 * Structure of the help drawer per tool (onboarding, Spec §4): which panels get a reading line
 * (`help.<tool>.read.<key>`) and which controls get a line (`help.<tool>.controls.<key>`). The names are the
 * headings and labels the tool itself shows (existing catalogue texts), so the drawer speaks the words of the
 * interface. `vars` fills a placeholder the tool fills too (e.g. "Schritt {n}"); `literal` is used where the tool
 * shows symbols instead of a label (the kernel parameter sliders).
 */
import type { MessageKey } from '../i18n'
import { LARGE_N } from './datalab/pipeline'
import type { ToolId } from './scenarios'

export interface ReadTopic {
  key: string
  /** The panel's own heading. */
  title: MessageKey
  vars?: Record<string, string>
}
export interface ControlTopic {
  key: string
  /** The control's own label, or a literal such as `σ, ℓ, …`. */
  label: MessageKey | { literal: string }
  vars?: Record<string, string>
}

/** The parameter sliders of a kernel are labelled by their symbols (Signalstärke σ, Längenskala ℓ, …). */
const KERNEL_PARAMS = { literal: 'σ, ℓ, …' }

export const HELP_TOPICS: Record<ToolId, { read: ReadTopic[]; controls: ControlTopic[] }> = {
  playground: {
    read: [
      { key: 'plot', title: 'playground.plotLabel' },
      { key: 'layers', title: 'playground.layers' },
      { key: 'inspector', title: 'playground.inspector' },
      { key: 'model', title: 'playground.model' },
      { key: 'mean', title: 'playground.mean' },
      { key: 'likelihood', title: 'playground.logML' },
      { key: 'covariance', title: 'playground.covariance' },
    ],
    controls: [
      { key: 'points', label: 'playground.layer.points' },
      { key: 'clear', label: 'playground.clear' },
      { key: 'layers', label: 'playground.layers' },
      { key: 'samples', label: 'playground.samplesSource' },
      { key: 'reset', label: 'playground.reset' },
      { key: 'fitAxes', label: 'playground.fitAxes' },
      { key: 'pin', label: 'playground.xStar' },
      { key: 'kernelParams', label: KERNEL_PARAMS },
      { key: 'hyper', label: 'playground.hyper' },
      { key: 'sigmaN', label: 'param.sigmaN' },
      { key: 'mean', label: 'playground.mean' },
      { key: 'optimize', label: 'playground.optimize' },
    ],
  },
  kernels: {
    read: [
      { key: 'formula', title: 'kernels.formula' },
      { key: 'samples', title: 'kernels.samples.title' },
      { key: 'heatmap', title: 'kernels.cov.title' },
      { key: 'slice', title: 'kernels.slice.title' },
      { key: 'validity', title: 'kernels.validity.title' },
      { key: 'builder', title: 'kernels.builder.title' },
    ],
    controls: [
      { key: 'gallery', label: 'kernels.gallery' },
      { key: 'reset', label: 'kernels.reset' },
      { key: 'builder', label: 'kernels.builder.kind' },
      { key: 'dims', label: 'kernels.builder.dims' },
      { key: 'warp', label: 'kernels.builder.warp' },
      { key: 'params', label: KERNEL_PARAMS },
      { key: 'redraw', label: 'kernels.samples.redraw' },
      { key: 'fitAxes', label: 'kernels.samples.fitAxes' },
      { key: 'x0', label: 'kernels.slice.x0' },
      { key: 'use', label: 'kernels.playground.use' },
      { key: 'useDatalab', label: 'kernels.transfer.useDatalab' },
    ],
  },
  datalab: {
    read: [
      { key: 'steps', title: 'datalab.stepN', vars: { n: '1–5' } },
      { key: 'data', title: 'datalab.step.data' },
      { key: 'target', title: 'datalab.step.target' },
      { key: 'split', title: 'datalab.step.split' },
      { key: 'model', title: 'datalab.step.model' },
      { key: 'result', title: 'datalab.step.result' },
      { key: 'parity', title: 'datalab.result.parity' },
      { key: 'calibration', title: 'datalab.result.calibration' },
      { key: 'slice', title: 'datalab.result.slice' },
      { key: 'relevance', title: 'datalab.result.relevance' },
      { key: 'runs', title: 'datalab.runs.title' },
    ],
    controls: [
      { key: 'data', label: 'datalab.data.yacht' },
      { key: 'csv', label: 'datalab.data.drop' },
      { key: 'next', label: 'datalab.next' },
      { key: 'target', label: 'datalab.target.target' },
      { key: 'logTarget', label: 'datalab.target.log' },
      { key: 'features', label: 'datalab.target.features' },
      { key: 'split', label: 'datalab.split.fraction' },
      { key: 'seed', label: 'datalab.split.seed' },
      { key: 'notebook', label: 'datalab.split.notebook' },
      { key: 'subsample', label: 'datalab.split.subsample', vars: { max: String(LARGE_N) } },
      { key: 'template', label: 'datalab.model.template' },
      { key: 'restarts', label: 'datalab.model.restarts' },
      { key: 'start', label: 'datalab.model.start' },
      { key: 'sliceFeature', label: 'datalab.result.sliceFeature' },
      { key: 'compare', label: 'datalab.runs.show' },
      { key: 'clearRuns', label: 'datalab.runs.clear' },
    ],
  },
}
