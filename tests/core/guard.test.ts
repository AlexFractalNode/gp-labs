import { describe, expect, it } from 'vitest'
import { findForbidden } from '../../scripts/check-no-materials.mjs'

describe('findForbidden', () => {
  it('flags notebooks, PDFs and materials directories only', () => {
    expect(
      findForbidden([
        'src/a.ts',
        'x/10_GP.ipynb',
        'lehrbuch.pdf',
        'materials/n.txt',
        'docs/a.md',
        'B.PDF',
        'sub/materials/x.csv',
        'src/materialsView.ts',
      ]),
    ).toEqual(['x/10_GP.ipynb', 'lehrbuch.pdf', 'materials/n.txt', 'B.PDF', 'sub/materials/x.csv'])
  })
})
