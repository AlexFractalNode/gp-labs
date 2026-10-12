// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Heatmap from '../../src/ui/Heatmap.vue'
import { fromRows } from '../../src/core/linalg'
import { setLang } from '../../src/i18n'

describe('Heatmap range legend', () => {
  afterEach(() => setLang('de'))
  const m = fromRows([
    [5.04e-7, 0.0266],
    [1, 0.5],
  ])
  it('uses the decimal comma and scientific notation for tiny values in German', () => {
    setLang('de')
    expect(mount(Heatmap, { props: { matrix: m } }).get('figcaption').text()).toBe('Wertebereich: 5,04E-7 bis 1')
  })
  it('uses the decimal point in English; ordinary magnitudes stay plain', () => {
    setLang('en')
    expect(mount(Heatmap, { props: { matrix: m } }).get('figcaption').text()).toBe('Value range: 5.04E-7 to 1')
    const plain = fromRows([[-0.0266, 1234.5]])
    expect(mount(Heatmap, { props: { matrix: plain } }).get('figcaption').text()).toBe('Value range: -0.0266 to 1230')
  })
})
