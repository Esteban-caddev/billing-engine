import { Decimal } from '../config'
import { checkInvariants } from '../invariants/invariants'
import { expectedDocument } from './fixtures'

/**
 * Teste le garde-fou lui-même (code réel, pas un stub) -> VERT.
 * C'est l'assurance que les niveaux supérieurs (golden, btp) détecteront bien les erreurs.
 */
describe('checkInvariants — règles de cohérence EN 16931', () => {
  it('le document golden ne viole aucun invariant', () => {
    expect(checkInvariants(expectedDocument())).toEqual([])
  })

  it('BR-CO-10 détectée si Σ BT-131 ≠ BT-106', () => {
    const doc = expectedDocument()
    doc.summation.lineNetTotal = new Decimal('1450.00') // faux
    expect(checkInvariants(doc).map((v) => v.rule)).toContain('BR-CO-10')
  })

  it('BR-CO-15 détectée si BT-111 ≠ BT-109 + BT-110', () => {
    const doc = expectedDocument()
    doc.summation.taxInclusive = new Decimal('1600.00') // faux
    expect(checkInvariants(doc).map((v) => v.rule)).toContain('BR-CO-15')
  })

  it('BR-CO-17 détectée si BT-117 ≠ BT-116 × taux', () => {
    const doc = expectedDocument()
    doc.vatBreakdown[0].taxAmount = new Decimal('999.99') // faux
    expect(checkInvariants(doc).map((v) => v.rule)).toContain('BR-CO-17')
  })
})
