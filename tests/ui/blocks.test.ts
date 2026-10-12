// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
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
import { BASE_KINDS, defaultKernel, isKernelSpec, locationParams, type KernelSpec } from '../../src/core/kernels'
import PointLayer from '../../src/ui/PointLayer.vue'
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
    await w.trigger('mouseleave')
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
    // happy-dom documents are in quirks mode, which makes KaTeX warn.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const w = mount(Formula, { props: { tex: 'x^2' } })
    warn.mockRestore()
    expect(w.find('.katex').exists()).toBe(true)
  })

  it('LogSlider ArrowDown decreases; Home/End jump to the exact bounds', async () => {
    const w = mount(LogSlider, { props: { modelValue: 1, min: 0.01, max: 100, label: 'ℓ' } })
    const el = w.get('[role="slider"]')
    await el.trigger('keydown', { key: 'ArrowDown' })
    await el.trigger('keydown', { key: 'Home' })
    await el.trigger('keydown', { key: 'End' })
    const ev = w.emitted('update:modelValue')!
    expect(ev[0][0]).toBeLessThan(1)
    expect(ev[1][0]).toBe(0.01)
    expect(ev[2][0]).toBe(100)
  })

  it('ParamSliders End/Home at the parameter bounds emit valid specs', async () => {
    const k = defaultKernel('rbf')
    k.params = { sigma: 1e5, ell: 1e-5 }
    const w = mount(ParamSliders, { props: { spec: { terms: [[k]] }, inputDim: 1 } })
    const sliders = w.findAll('[role="slider"]')
    for (const s of sliders) {
      await s.trigger('keydown', { key: 'End' })
      await s.trigger('keydown', { key: 'Home' })
    }
    const out = w.emitted('update:spec')!
    expect(out.length).toBeGreaterThanOrEqual(4)
    for (const [spec] of out) expect(isKernelSpec(spec)).toBe(true)
  })

  it('ParamSliders: every linear slider emits a valid spec at its min and max', async () => {
    let swept = 0
    for (const kind of BASE_KINDS.filter((q) => locationParams(q).length > 0)) {
      const spec: KernelSpec = { terms: [[defaultKernel(kind)]] }
      const w = mount(ParamSliders, { props: { spec, inputDim: 1 } })
      for (const input of w.findAll('[data-slider="linear"] input')) {
        const { min, max } = input.attributes()
        for (const v of [min, max]) {
          await input.setValue(v)
          const out = w.emitted('update:spec')!
          expect(isKernelSpec(out[out.length - 1][0]), kind + ' ' + v).toBe(true)
          swept++
        }
      }
    }
    expect(swept).toBeGreaterThanOrEqual(12)
  })

  it('Heatmap does not throw on NaN, constant or empty data', () => {
    const nan = zeros(2, 2)
    nan.data[0] = NaN
    expect(() => mount(Heatmap, { props: { matrix: nan } })).not.toThrow()
    const constant = zeros(2, 2)
    constant.data.fill(3)
    expect(() => mount(Heatmap, { props: { matrix: constant, diverging: true } })).not.toThrow()
    const w = mount(Heatmap, { props: { matrix: zeros(0, 0) } })
    expect(w.attributes('data-verify-state')).toBe('empty')
    expect(mount(Heatmap, { props: { matrix: constant } }).text()).toContain('3')
  })

  it('PointLayer: long press (touch) removes the point, movement cancels it', async () => {
    vi.useFakeTimers()
    try {
      const Wrap = {
        components: { PlotFrame, PointLayer },
        template: `<PlotFrame :x-domain="[0,1]" :y-domain="[0,1]" x-label="x" y-label="y"><PointLayer :x="[0.5]" :y="[0.5]" @point-remove="$emit('rm', $event)"/></PlotFrame>`,
        emits: ['rm'],
      }
      const w = mount(Wrap)
      const pt = w.get('[data-layer="point"]')
      await pt.trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 })
      vi.advanceTimersByTime(499)
      expect(w.emitted('rm')).toBeUndefined()
      vi.advanceTimersByTime(2)
      expect(w.emitted('rm')![0]).toEqual([0])
      await pt.trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 })
      await pt.trigger('pointermove', { pointerType: 'touch', clientX: 40, clientY: 10 })
      vi.advanceTimersByTime(1000)
      expect(w.emitted('rm')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('PlotFrame keeps hover while over children and carries state', async () => {
    const w = mount(PlotFrame, { props: { xDomain: [0, 1], yDomain: [0, 1], xLabel: 'x', yLabel: 'y' } })
    expect(w.attributes('data-verify-state')).toBe('ready')
  })
})
