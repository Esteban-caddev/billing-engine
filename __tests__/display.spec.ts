import { computeDocument } from '../pipeline/computeDocument'
import { flattenTree } from '../pipeline/flattenTree'
import { toDisplay } from '../display/toDisplay'
import { referenceTree } from './fixtures'

/**
 * Modèle d'affichage. Vérifie les règles d'arrondi d'affichage (doc/moteur-calcul-partage.md §1.3).
 * ROUGE tant que toDisplay n'est pas implémenté.
 */
describe("toDisplay — modèle d'affichage PDF", () => {
  const build = () =>
    toDisplay(
      computeDocument(flattenTree(referenceTree()), { globalDiscountPercentage: 5 })
    )

  it('BT-146 — prix unitaire affiché à 4 décimales', () => {
    const a1 = build().lines.find((l) => l.lineId === 'A1')!
    expect(a1.unitPrice).toBe('99.0000')
  })

  it('BT-131 — montant de ligne affiché à 2 décimales', () => {
    const a1 = build().lines.find((l) => l.lineId === 'A1')!
    expect(a1.netAmount).toBe('594.00')
  })

  it('BT-109 / BT-111 — totaux HT / TTC à 2 décimales', () => {
    const v = build()
    expect(v.totalHT).toBe('1379.40')
    expect(v.totalTTC).toBe('1634.38')
  })

  it('net à encaisser BTP affiché (= BT-115 ici, sans retenue)', () => {
    expect(build().netToCollect).toBe('1634.38')
  })
})
