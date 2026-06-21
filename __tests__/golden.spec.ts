import { computeDocument } from '../pipeline/computeDocument'
import { flattenTree } from '../pipeline/flattenTree'
import { checkInvariants } from '../invariants/invariants'
import { ComputedLine, EN16931Document } from '../model'
import { expectedDocument, referenceTree } from './fixtures'

/**
 * Test "golden" du pipeline complet sur le devis de référence (doc/analyse.md §4).
 * ROUGE tant que flattenTree / computeDocument ne sont pas implémentés.
 */
describe('Golden — devis de référence (doc/analyse.md §4)', () => {
  let doc: EN16931Document
  const expected = expectedDocument()

  beforeAll(() => {
    const lines = flattenTree(referenceTree())
    doc = computeDocument(lines, { globalDiscountPercentage: 5 })
  })

  const line = (d: EN16931Document, id: string) =>
    d.lines.find((l) => l.lineId === id) as ComputedLine

  it.each(['A1', 'A2', 'B1', 'B2'])('ligne %s — BT-129 / BT-146 / BT-131', (id) => {
    const got = line(doc, id)
    const exp = expected.lines.find((l) => l.lineId === id)!
    expect(got.quantity.toFixed(2)).toBe(exp.quantity.toFixed(2)) // BT-129
    expect(got.netUnitPrice.toFixed(4)).toBe(exp.netUnitPrice.toFixed(4)) // BT-146
    expect(got.netAmount.toFixed(2)).toBe(exp.netAmount.toFixed(2)) // BT-131
  })

  it('BT-106 — Sum of line net amount = 1 452,00', () => {
    expect(doc.summation.lineNetTotal.toFixed(2)).toBe('1452.00')
  })
  it('BT-107 — Sum of document allowances = 72,60', () => {
    expect(doc.summation.allowanceTotal.toFixed(2)).toBe('72.60')
  })
  it('BT-109 — Total without VAT = 1 379,40', () => {
    expect(doc.summation.taxExclusive.toFixed(2)).toBe('1379.40')
  })
  it('BT-110 — Total VAT = 254,98', () => {
    expect(doc.summation.taxTotal.toFixed(2)).toBe('254.98')
  })
  it('BT-111 — Total with VAT = 1 634,38', () => {
    expect(doc.summation.taxInclusive.toFixed(2)).toBe('1634.38')
  })
  it('BT-115 — Amount due for payment = 1 634,38', () => {
    expect(doc.summation.payable.toFixed(2)).toBe('1634.38')
  })

  it('BG-23 — TVA S/20 : BT-116 = 1 170,40 / BT-117 = 234,08', () => {
    const g = doc.vatBreakdown.find((x) => x.vatRate.toNumber() === 20)!
    expect(g.taxableAmount.toFixed(2)).toBe('1170.40')
    expect(g.taxAmount.toFixed(2)).toBe('234.08')
  })
  it('BG-23 — TVA S/10 : BT-116 = 209,00 / BT-117 = 20,90', () => {
    const g = doc.vatBreakdown.find((x) => x.vatRate.toNumber() === 10)!
    expect(g.taxableAmount.toFixed(2)).toBe('209.00')
    expect(g.taxAmount.toFixed(2)).toBe('20.90')
  })

  it('respecte tous les invariants BR-CO-*', () => {
    expect(checkInvariants(doc)).toEqual([])
  })
})
