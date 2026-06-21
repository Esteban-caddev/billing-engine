import { NodeMargins } from '../model'

/**
 * Calcul de marges — HORS EN 16931. Port fidèle de `fullMarginCalculation` /
 * `marginBrutCalculation` / `marginNetCalculation` du front (mêmes cas limites).
 *
 *  - marge brute  : prix de vente remisé − déboursé matière (materialPrice)
 *  - marge nette  : prix de vente remisé − coût de revient (costPrice)
 */
export function computeMargins(
  sellPriceWithDiscount: number,
  materialPrice: number,
  costPrice: number
): NodeMargins {
  // Marge brute
  let marginBrut: number
  let marginBrutPercentage: number
  if (!sellPriceWithDiscount) {
    marginBrut = 0
    marginBrutPercentage = 0
  } else if (!materialPrice || Number(materialPrice) === 0) {
    marginBrut = sellPriceWithDiscount
    marginBrutPercentage = 100
  } else {
    marginBrut = sellPriceWithDiscount - materialPrice
    marginBrutPercentage = (marginBrut / sellPriceWithDiscount) * 100
  }

  // Marge nette
  let marginNet: number
  let marginNetPercentage: number
  if (!sellPriceWithDiscount) {
    marginNet = 0
    marginNetPercentage = 0
  } else if (costPrice === 0) {
    marginNet = sellPriceWithDiscount
    marginNetPercentage = 100
  } else {
    marginNet = sellPriceWithDiscount - costPrice
    marginNetPercentage = (marginNet / sellPriceWithDiscount) * 100
  }

  return { marginBrut, marginNet, marginBrutPercentage, marginNetPercentage }
}
