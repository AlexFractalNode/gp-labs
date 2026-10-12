// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StatusPanel from '../../src/ui/StatusPanel.vue'
import LogSlider from '../../src/ui/LogSlider.vue'
import RefBadge from '../../src/ui/RefBadge.vue'
import ParamSliders from '../../src/ui/ParamSliders.vue'
import Heatmap from '../../src/ui/Heatmap.vue'
import PlotFrame from '../../src/ui/PlotFrame.vue'
import LineLayer from '../../src/ui/LineLayer.vue'
import BandLayer from '../../src/ui/BandLayer.vue'
import Formula from '../../src/ui/Formula.vue'
import { defaultKernel, type KernelSpec } from '../../src/core/kernels'
import { zeros } from '../../src/core/linalg'

describe('UI building blocks', () => {
  it('StatusPanel exposes the data-verify contract', () => {
    const w = mount(StatusPanel, { props: { unit: 'u', state: 'error', error: 'x' } })
    const root = w.get('[data-verify-unit="u"]')
    expect(root.attributes('data-verify-state')).toBe('error')
    expect(root.attributes('data-verify-error')).toBe('x')
    expect(w.find('[role="alert"]').exists()).toBe(true)
  })

  it('StatusPanel ready carries count and no error attribute', () => {
    const w = mount(StatusPanel, { props: { unit: 'u', state: 'ready', count: 3 } })
    expect(w.attributes('data-verify-count')).toBe('3')
    expect(w.attributes('data-verify-error')).toBeUndefined()
  })

  it('LogSlider ArrowUp increases the value', async () => {
    const w = mount(LogSlider, { props: { modelValue: 1, min: 0.01, max: 100, label: 'ℓ' } })
    await w.get('[role="slider"]').trigger('keydown', { key: 'ArrowUp' })
    const ev = w.emitted('update:modelValue')!
    expect(ev[0][0]).toBeGreaterThan(1)
    expect(w.get('[role="slider"]').attributes('aria-valuetext')).toBeTruthy()
  })

  it('RefBadge renders chapter and code', () => {
    const w = mount(RefBadge, { props: { chapter: '9', code: '39' } })
    expect(w.text()).toContain('Kap. 9')
    expect(w.text()).toContain('Code 39')
  })

  it('ParamSliders renders 5 log sliders for rbf + periodic', () => {
    const spec: KernelSpec = { terms: [[defaultKernel('rbf')], [defaultKernel('periodic')]] }
    const w = mount(ParamSliders, { props: { spec, inputDim: 1 } })
    expect(w.findAll('[data-slider="log"]')).toHaveLength(5)
    expect(w.findAll('[data-slider="linear"]')).toHaveLength(0)
  })

  it('ParamSliders emits a new spec for a linear (location) slider without mutating props', async () => {
    const spec: KernelSpec = { terms: [[defaultKernel('linear')]] }
    const w = mount(ParamSliders, { props: { spec, inputDim: 1 } })
    expect(w.findAll('[data-slider="log"]')).toHaveLength(1)
    expect(w.findAll('[data-slider="linear"]')).toHaveLength(1)
    await w.get('[data-slider="linear"] input').setValue('2')
    const out = w.emitted('update:spec')![0][0] as KernelSpec
    expect(out.terms[0][0].params.c).toBe(2)
    expect(spec.terms[0][0].params.c).toBe(0)
  })

  it('Heatmap mounts without error under happy-dom', () => {
    const w = mount(Heatmap, { props: { matrix: zeros(3, 3), diverging: true } })
    expect(w.find('canvas').exists()).toBe(true)
  })

  it('PlotFrame renders an svg and emits plot-hover null on mouseleave', async () => {
    const w = mount(PlotFrame, { props: { xDomain: [0, 1], yDomain: [0, 1], xLabel: 'x', yLabel: 'y' } })
    await w.get('rect.capture').trigger('mouseleave')
    expect(w.emitted('plot-hover')![0]).toEqual([null])
  })

  it('Line and Band layers render paths inside a frame', () => {
    const Wrap = {
      components: { PlotFrame, LineLayer, BandLayer },
      template: `<PlotFrame :x-domain="[0,1]" :y-domain="[-1,1]" x-label="x" y-label="y">
        <BandLayer :x="[0,0.5,1]" :lower="[-1,-0.5,-1]" :upper="[1,0.5,1]" variant="y"/>
        <LineLayer :x="[0,0.5,1]" :y="[0,0.5,0]" variant="mean"/></PlotFrame>`,
    }
    const w = mount(Wrap)
    expect(w.findAll('path[data-layer]').length).toBe(2)
  })

  it('Formula renders KaTeX', () => {
    const w = mount(Formula, { props: { tex: 'x^2' } })
    expect(w.find('.katex').exists()).toBe(true)
  })
})
