import { Decimal, ZERO, money } from '../config'
import {
  AllowanceCharge,
  ComputedLine,
  DocumentParams,
  EN16931Document,
  FlatLine,
  RetainageSummary,
  VatGroup,
} from '../model'

/**
 * Calcule le document EN 16931 à partir des lignes plates.
 *
 *   BT-131 = round(BT-129 × BT-146, 2)         ← arrondi UNE seule fois, ici
 *   BT-106 = Σ BT-131                            (BR-CO-10)
 *   remise globale -> 1 remise document par groupe TVA (BG-20)
 *   BT-116/117 par (catégorie, taux)            (BR-S-08/09, BR-CO-17)
 *   BT-109 = BT-106 − BT-107 + BT-108           (BR-CO-13)
 *   BT-110 = Σ BT-117                            (BR-CO-14)
 *   BT-111 = BT-109 + BT-110                     (BR-CO-15)
 *   BT-115 = BT-111 − BT-112 + BT-113           (BR-CO-16)
 *
 * cf. doc/moteur-calcul-partage.md §1 (règles d'arrondi).
 */
export function computeDocument(
  lines: FlatLine[],
  params: DocumentParams = {}
): EN16931Document {
  // Étape 1 : Calculer netAmount pour chaque ligne (BT-131 = money(BT-129 × BT-146))
  const computedLines: ComputedLine[] = lines.map((line) => ({
    ...line,
    netAmount: money(line.quantity.times(line.netUnitPrice)),
  }))

  // Étape 2 : BT-106 = Σ BT-131
  const lineNetTotal = computedLines.reduce(
    (acc, l) => acc.plus(l.netAmount),
    ZERO
  )

  // Étape 3 : Grouper par (vatCategory, vatRate) en préservant l'ordre de première apparition
  const groupMap = new Map<string, { vatCategory: string; vatRate: Decimal; netAmounts: Decimal[] }>()

  for (const line of computedLines) {
    const key = `${line.vatCategory}|${line.vatRate.toFixed()}`
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        vatCategory: line.vatCategory,
        vatRate: line.vatRate,
        netAmounts: [],
      })
    }
    groupMap.get(key)!.netAmounts.push(line.netAmount)
  }

  // Calculer la base de chaque groupe (somme des netAmount)
  const groups = Array.from(groupMap.values()).map((g) => ({
    vatCategory: g.vatCategory,
    vatRate: g.vatRate,
    base: g.netAmounts.reduce((acc, a) => acc.plus(a), ZERO),
  }))

  // Étape 4 : Remise globale
  const gd = params.globalDiscountPercentage ?? 0
  const documentAllowances: AllowanceCharge[] = []

  if (gd > 0) {
    for (const group of groups) {
      const baseAmount = money(group.base)
      const allowanceAmount = money(group.base.times(new Decimal(gd)).div(100))
      documentAllowances.push({
        isCharge: false,
        amount: allowanceAmount,
        baseAmount,
        percentage: new Decimal(gd),
        vatCategory: group.vatCategory,
        vatRate: group.vatRate,
        reason: 'Remise globale',
      })
    }
  }

  // Étape 5 : documentCharges = [], chargeTotal = 0
  const documentCharges: AllowanceCharge[] = []
  const chargeTotal = money(ZERO)

  // Étape 6 : allowanceTotal = Σ amount des remises
  const allowanceTotal = documentAllowances.reduce(
    (acc, a) => acc.plus(a.amount),
    ZERO
  )

  // Étape 7 : vatBreakdown
  // Pour chaque groupe : taxableAmount = base − allowanceDuGroupe (0 si pas de remise)
  // taxAmount = money(taxableAmount × vatRate / 100)
  const vatBreakdown: VatGroup[] = groups.map((group) => {
    const allowance = documentAllowances.find(
      (a) =>
        a.vatCategory === group.vatCategory &&
        a.vatRate.eq(group.vatRate)
    )
    const allowanceAmount = allowance ? allowance.amount : ZERO
    const taxableAmount = money(group.base.minus(allowanceAmount))
    const taxAmount = money(taxableAmount.times(group.vatRate).div(100))
    return {
      vatCategory: group.vatCategory,
      vatRate: group.vatRate,
      taxableAmount,
      taxAmount,
    }
  })

  // Étape 8 : taxExclusive (BT-109) = money(lineNetTotal − allowanceTotal + chargeTotal)
  const taxExclusive = money(lineNetTotal.minus(allowanceTotal).plus(chargeTotal))

  // Étape 9 : taxTotal (BT-110) = Σ taxAmount
  const taxTotal = vatBreakdown.reduce((acc, g) => acc.plus(g.taxAmount), ZERO)

  // Étape 10 : taxInclusive (BT-111) = money(taxExclusive + taxTotal)
  const taxInclusive = money(taxExclusive.plus(taxTotal))

  // Étape 11 : prepaid, rounding
  const prepaid = money(params.prepaid ?? 0)
  const rounding = money(params.rounding ?? 0)

  // Étape 12 : payable (BT-115) = money(taxInclusive − prepaid + rounding)
  const payable = money(taxInclusive.minus(prepaid).plus(rounding))

  // Étape 13 : Retenues BTP (hors sommation EN 16931 — BT-106..115 restent standard)
  const prorataPercentage = new Decimal(params.prorataPercentage ?? 0)
  const garantiePercentage = new Decimal(params.garantiePercentage ?? 0)
  const bankGuaranty = params.bankGuaranty ?? false

  const prorataBase = taxExclusive                              // base HT = BT-109
  const prorataAmount = money(prorataBase.times(prorataPercentage).div(100))

  const garantieBase = taxInclusive                             // base TTC = BT-111
  const garantieAmount = bankGuaranty
    ? money(ZERO)
    : money(garantieBase.times(garantiePercentage).div(100))

  const netToCollect = money(payable.minus(prorataAmount).minus(garantieAmount))

  const retainage: RetainageSummary = {
    prorataBase,
    prorataPercentage,
    prorataAmount,
    garantieBase,
    garantiePercentage,
    garantieAmount,
    bankGuaranty,
    netToCollect,
  }

  return {
    lines: computedLines,
    documentAllowances,
    documentCharges,
    vatBreakdown,
    summation: {
      lineNetTotal: money(lineNetTotal),
      allowanceTotal: money(allowanceTotal),
      chargeTotal,
      taxExclusive,
      taxTotal: money(taxTotal),
      taxInclusive,
      prepaid,
      rounding,
      payable,
    },
    retainage,
    precedingInvoiceRefs: params.precedingInvoiceRefs ?? [],
    calculationVersion: params.calculationVersion ?? '3.0.0',
  }
}
