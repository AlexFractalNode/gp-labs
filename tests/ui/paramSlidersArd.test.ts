// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ParamSliders from '../../src/ui/ParamSliders.vue'
import type { KernelSpec } from '../../src/core/kernels'

describe('ParamSliders with a changing input dimension', () => {
  it('accepts an ARD spec and inputDim 2 in the same update (and back) without throwing', async () => {
    const errors: unknown[] = []
    const iso: KernelSpec = { terms: [[{ kind: 'rbf', params: { sigma: 1, ell: 0.5 } }]] }
    const ard: KernelSpec = { terms: [[{ kind: 'rbf', params: { sigma: 1, ell_0: 0.2, ell_1: 1 }, ard: true }]] }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const w = mount(ParamSliders, {
      props: { spec: iso, inputDim: 1 },
      global: { config: { errorHandler: (e) => errors.push(e) } },
    })
    expect(w.findAll('[data-slider="log"]')).toHaveLength(2)
    await w.setProps({ spec: ard, inputDim: 2 })
    expect(errors).toEqual([])
    expect(w.findAll('[data-slider="log"]')).toHaveLength(3)
    await w.setProps({ spec: iso, inputDim: 1 })
    expect(errors).toEqual([])
    expect(w.findAll('[data-slider="log"]')).toHaveLength(2)
    warn.mockRestore()
  })
})
