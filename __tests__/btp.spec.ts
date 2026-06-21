import { applyBilling } from '../pipeline/applyBilling'
import { computeDocument } from '../pipeline/computeDocument'
import { flattenTree } from '../pipeline/flattenTree'
import { referenceTree } from './fixtures'

/**
 * Règles de facturation BTP (cf. doc/facturation-btp.md).
 * ROUGE tant que applyBilling / computeDocument ne sont pas implémentés.
 */
describe('Facturation BTP', () => {
  describe('Avancement (situations)', () => {
    it('BT-129 — une situation à 50 % facture la moitié des quantités', () => {
      const lines = flattenTree(referenceTree())
      const at50 = applyBilling(lines, {
        mode: 'advancement',
        percentByNodeKey: { A1: 50, A2: 50, B1: 50, B2: 50 },
      })
      expect(at50.find((l) => l.lineId === 'A1')!.quantity.toNumber()).toBe(3) // 6 × 50 %
    })

    it('Σ situations = marché (50 % + 50 % = 100 %) — BR-CO-10 cumulée', () => {
      const lines = flattenTree(referenceTree())
      const half = {
        mode: 'advancement' as const,
        percentByNodeKey: { A1: 50, A2: 50, B1: 50, B2: 50 },
      }
      const s1 = computeDocument(applyBilling(lines, half), { globalDiscountPercentage: 5 })
      const s2 = computeDocument(applyBilling(lines, half), { globalDiscountPercentage: 5 })
      const cumul = s1.summation.taxInclusive.plus(s2.summation.taxInclusive)
      expect(cumul.toFixed(2)).toBe('1634.38')
    })
  })

  describe('Acompte piochable (BT-112 / BT-115)', () => {
    it('BR-CO-16 — un acompte pioché de 500 € réduit le net à payer', () => {
      const lines = flattenTree(referenceTree())
      const doc = computeDocument(lines, { globalDiscountPercentage: 5, prepaid: 500 })
      expect(doc.summation.prepaid.toFixed(2)).toBe('500.00') // BT-112
      expect(doc.summation.payable.toFixed(2)).toBe('1134.38') // BT-115 = 1 634,38 − 500
    })
  })

  describe('Compte prorata (retenue, base HT) — décision : soustrait', () => {
    it('prorata 2 % réduit le net à encaisser SANS toucher BT-109 / BT-111', () => {
      const lines = flattenTree(referenceTree())
      const doc = computeDocument(lines, {
        globalDiscountPercentage: 5,
        prorataPercentage: 2,
      })
      expect(doc.summation.taxExclusive.toFixed(2)).toBe('1379.40') // BT-109 inchangé
      expect(doc.summation.taxInclusive.toFixed(2)).toBe('1634.38') // BT-111 inchangé
      expect(doc.retainage.prorataAmount.toFixed(2)).toBe('27.59') // 1 379,40 × 2 %
      expect(doc.retainage.netToCollect.toFixed(2)).toBe('1606.79') // 1 634,38 − 27,59
    })
  })

  describe('Retenue de garantie (base TTC)', () => {
    it('RG 5 % retenue sur le net à encaisser', () => {
      const lines = flattenTree(referenceTree())
      const doc = computeDocument(lines, {
        globalDiscountPercentage: 5,
        garantiePercentage: 5,
      })
      expect(doc.retainage.garantieAmount.toFixed(2)).toBe('81.72') // 1 634,38 × 5 %
      expect(doc.retainage.netToCollect.toFixed(2)).toBe('1552.66') // 1 634,38 − 81,72
    })

    it('caution bancaire : aucune retenue de garantie (bankGuaranty = true)', () => {
      const lines = flattenTree(referenceTree())
      const doc = computeDocument(lines, {
        globalDiscountPercentage: 5,
        garantiePercentage: 5,
        bankGuaranty: true,
      })
      expect(doc.retainage.garantieAmount.toFixed(2)).toBe('0.00')
      expect(doc.retainage.netToCollect.toFixed(2)).toBe('1634.38') // = BT-115 plein
    })
  })

  describe('Prorata + garantie cumulés', () => {
    it('net à encaisser = BT-115 − prorata − garantie', () => {
      const lines = flattenTree(referenceTree())
      const doc = computeDocument(lines, {
        globalDiscountPercentage: 5,
        prorataPercentage: 2,
        garantiePercentage: 5,
      })
      expect(doc.retainage.netToCollect.toFixed(2)).toBe('1525.07') // 1 634,38 − 27,59 − 81,72
    })
  })
})
