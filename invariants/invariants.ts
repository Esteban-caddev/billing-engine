import { Decimal } from '../config'
import { EN16931Document } from '../model'

/**
 * Garde-fou des règles de cohérence EN 16931 (BR-CO-*, BR-CO-17).
 * Pur : prend un document, retourne la liste des règles violées.
 * Utilisable en test ET en garde d'exécution (dev).
 */
export interface Violation {
  rule: string
  message: string
}

const eq = (a: Decimal, b: Decimal): boolean => a.toFixed(2) === b.toFixed(2)

export function checkInvariants(doc: EN16931Document): Violation[] {
  const v: Violation[] = []
  const s = doc.summation
  const sum = (arr: Decimal[]) => arr.reduce((a, x) => a.plus(x), new Decimal(0))

  // BR-CO-10 — BT-106 = Σ BT-131
  const sumLines = sum(doc.lines.map((l) => l.netAmount))
  if (!eq(sumLines, s.lineNetTotal))
    v.push({
      rule: 'BR-CO-10',
      message: `Σ BT-131 (${sumLines.toFixed(2)}) ≠ BT-106 (${s.lineNetTotal.toFixed(2)})`,
    })

  // BR-CO-11 — BT-107 = Σ BT-92 (remises document)
  const sumAllow = sum(doc.documentAllowances.map((a) => a.amount))
  if (!eq(sumAllow, s.allowanceTotal))
    v.push({
      rule: 'BR-CO-11',
      message: `Σ BT-92 (${sumAllow.toFixed(2)}) ≠ BT-107 (${s.allowanceTotal.toFixed(2)})`,
    })

  // BR-CO-12 — BT-108 = Σ BT-99 (charges document)
  const sumCharge = sum(doc.documentCharges.map((c) => c.amount))
  if (!eq(sumCharge, s.chargeTotal))
    v.push({
      rule: 'BR-CO-12',
      message: `Σ BT-99 (${sumCharge.toFixed(2)}) ≠ BT-108 (${s.chargeTotal.toFixed(2)})`,
    })

  // BR-CO-13 — BT-109 = BT-106 − BT-107 + BT-108
  if (!eq(s.taxExclusive, s.lineNetTotal.minus(s.allowanceTotal).plus(s.chargeTotal)))
    v.push({ rule: 'BR-CO-13', message: 'BT-109 ≠ BT-106 − BT-107 + BT-108' })

  // BR-CO-14 — BT-110 = Σ BT-117
  const sumTax = sum(doc.vatBreakdown.map((g) => g.taxAmount))
  if (!eq(sumTax, s.taxTotal))
    v.push({
      rule: 'BR-CO-14',
      message: `Σ BT-117 (${sumTax.toFixed(2)}) ≠ BT-110 (${s.taxTotal.toFixed(2)})`,
    })

  // BR-CO-15 — BT-111 = BT-109 + BT-110
  if (!eq(s.taxInclusive, s.taxExclusive.plus(s.taxTotal)))
    v.push({ rule: 'BR-CO-15', message: 'BT-111 ≠ BT-109 + BT-110' })

  // BR-CO-16 — BT-115 = BT-111 − BT-112 + BT-113
  if (!eq(s.payable, s.taxInclusive.minus(s.prepaid).plus(s.rounding)))
    v.push({ rule: 'BR-CO-16', message: 'BT-115 ≠ BT-111 − BT-112 + BT-113' })

  // BR-CO-17 — BT-117 = BT-116 × (BT-119 / 100), arrondi 2 décimales
  for (const g of doc.vatBreakdown) {
    const expected = g.taxableAmount
      .times(g.vatRate)
      .div(100)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    if (!eq(expected, g.taxAmount))
      v.push({
        rule: 'BR-CO-17',
        message: `BT-117 (${g.taxAmount.toFixed(2)}) ≠ BT-116 × taux (${expected.toFixed(2)}) pour ${g.vatCategory}/${g.vatRate.toFixed(0)}`,
      })
  }

  return v
}
