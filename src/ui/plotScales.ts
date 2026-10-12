import type { ScaleLinear } from 'd3-scale'

export type Variant = 'f' | 'y' | 'mean' | 'sample' | 'prior' | 'truth'

export interface PlotScales {
  x: ScaleLinear<number, number>
  y: ScaleLinear<number, number>
  /** Client pixel position to data coordinates (null if the frame has no layout). */
  toData: (clientX: number, clientY: number) => { x: number; y: number } | null
}

/** Injection key under which PlotFrame provides a ComputedRef<PlotScales>. */
export const PLOT_SCALES = 'plotScales'
