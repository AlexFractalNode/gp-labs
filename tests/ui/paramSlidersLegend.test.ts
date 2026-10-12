// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ParamSliders from '../../src/ui/ParamSliders.vue'
import { setLang } from '../../src/i18n'
import type { KernelSpec } from '../../src/core/kernels'

describe('ParamSliders group legend', () => {
  it('names term, factor and kernel in words (DE and EN)', async () => {
    const spec: KernelSpec = {
      terms: [
        [{ kind: 'rbf', params: { sigma: 1, ell: 0.5 } }],
        [
          { kind: 'linear', params: { sigma0: 1, c: 0 } },
          { kind: 'periodic', params: { sigma: 1, ell: 1, period: 2 } },
        ],
      ],
    }
    setLang('de')
    const w = mount(ParamSliders, { props: { spec, inputDim: 1 } })
    const legends = () => w.findAll('legend').map((l) => l.text())
    expect(legends()).toEqual(['Term 1 · Faktor 1: RBF', 'Term 2 · Faktor 1: Linear', 'Term 2 · Faktor 2: Periodisch'])
    setLang('en')
    await w.vm.$nextTick()
    expect(legends()[2]).toBe('Term 2 · Factor 2: Periodic')
    setLang('de')
  })
})
