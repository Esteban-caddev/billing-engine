import { DisplayModel, DisplayOptions, EN16931Document } from '../model'

/**
 * Construit le modèle d'affichage (PDF / écran) à partir du document EN 16931.
 *
 * Règle d'arrondi d'affichage (doc/moteur-calcul-partage.md §1.3) :
 *  - montants (BT-131, totaux) : 2 décimales ;
 *  - prix unitaire (BT-146) : 4 décimales (pour que quantité × PU reproduise la ligne) ;
 *  - le montant de ligne reste la valeur de référence.
 */
export function toDisplay(
  doc: EN16931Document,
  _opts: DisplayOptions = {}
): DisplayModel {
  return {
    lines: doc.lines.map((line) => ({
      lineId: line.lineId,
      name: line.name,
      unitCode: line.unitCode,
      quantity: line.quantity.toString(),
      unitPrice: line.netUnitPrice.toFixed(4),
      netAmount: line.netAmount.toFixed(2),
      vatRate: line.vatRate.toString(),
    })),
    totalHT: doc.summation.taxExclusive.toFixed(2),
    totalVAT: doc.summation.taxTotal.toFixed(2),
    totalTTC: doc.summation.taxInclusive.toFixed(2),
    netToCollect: doc.retainage.netToCollect.toFixed(2),
  }
}
