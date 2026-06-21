import { flattenTree } from '../pipeline/flattenTree'
import { referenceTree } from './fixtures'

/**
 * Bridge arbre métier -> lignes plates. Vérifie BT-129 (quantité) et BT-146 (prix net),
 * et que la remise globale ne descend PAS dans la ligne (cf. doc/analyse.md §4.3).
 * ROUGE tant que flattenTree n'est pas implémenté.
 */
describe('flattenTree — arbre métier -> lignes (BT-129 / BT-146)', () => {
  it('produit une ligne par produit feuille', () => {
    const lines = flattenTree(referenceTree())
    expect(lines.map((l) => l.lineId).sort()).toEqual(['A1', 'A2', 'B1', 'B2'])
  })

  it('BT-129 — quantité = qté produit × Π(qté ancêtres)', () => {
    const lines = flattenTree(referenceTree())
    const q = (id: string) => lines.find((l) => l.lineId === id)!.quantity.toNumber()
    expect(q('A1')).toBe(6) // 3 × section A (2)
    expect(q('A2')).toBe(4) // 2 × 2
    expect(q('B1')).toBe(1) // 1 × section B (1)
    expect(q('B2')).toBe(5) // 5 × 1
  })

  it('BT-146 — prix net = sellPrice × (1+maj) × (1−remises), HORS remise globale', () => {
    const lines = flattenTree(referenceTree())
    const p = (id: string) => lines.find((l) => l.lineId === id)!.netUnitPrice.toFixed(4)
    expect(p('A1')).toBe('99.0000') // 100 ×1,10 ×0,90
    expect(p('A2')).toBe('49.5000') // 50  ×1,10 ×0,90
    expect(p('B1')).toBe('220.0000') // 200 ×1,10
    expect(p('B2')).toBe('88.0000') // 80  ×1,10
  })

  it('la remise globale (5 %) reste au niveau document, pas dans BT-146', () => {
    const lines = flattenTree(referenceTree())
    // A1 = 99,00 et NON 99 × 0,95 = 94,05
    expect(lines.find((l) => l.lineId === 'A1')!.netUnitPrice.toFixed(2)).toBe('99.00')
  })

  it('BT-151 / BT-152 — catégorie et taux de TVA portés sur la ligne', () => {
    const lines = flattenTree(referenceTree())
    const b1 = lines.find((l) => l.lineId === 'B1')!
    expect(b1.vatCategory).toBe('S')
    expect(b1.vatRate.toNumber()).toBe(10)
  })
})
