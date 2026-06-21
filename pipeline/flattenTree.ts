import { Decimal } from '../config'
import { FlatLine, FlattenOptions, SerializedNode } from '../model'

/**
 * Aplatit l'arbre métier en lignes EN 16931 (1 ligne = 1 produit feuille).
 *
 *   BT-129 (quantité) = quantité produit × Π(quantités des ancêtres)
 *   BT-146 (prix net) = sellPrice × (1 + majGlobale) × Π(1 − remiseAncêtre) × (1 − remiseProduit)   [EXACT]
 *
 * La remise globale (BG-20) reste au niveau document : elle n'entre PAS dans BT-146.
 * cf. doc/analyse.md §4.3 et doc/billing-engine-structure.md §2.
 */
export function flattenTree(
  tree: SerializedNode,
  _opts: FlattenOptions = {}
): FlatLine[] {
  const result: FlatLine[] = []

  // La majoration globale est lue sur la proposition racine et fondue dans le prix.
  const globalMaj = tree.value.globalMajorationPercentage ?? 0
  const rootPriceFactor = new Decimal(1).plus(new Decimal(globalMaj).div(100))

  function walk(
    node: SerializedNode,
    qtyFactor: Decimal,
    priceFactor: Decimal
  ): void {
    const { value } = node

    // Ignorer les noeuds dont la variante/option n'est pas sélectionnée
    if (value.variantOptionIsSelected === false) return

    // Ignorer les commentaires
    if (value.nodeType === 'commentary') return

    if (value.nodeType === 'product') {
      const sellPrice = new Decimal(value.sellPrice ?? 0)
      const productDiscount = new Decimal(value.discountPercentage ?? 0)
      const productQty = new Decimal(value.quantity ?? 1)

      const netUnitPrice = sellPrice
        .times(priceFactor)
        .times(new Decimal(1).minus(productDiscount.div(100)))

      const quantity = qtyFactor.times(productQty)

      result.push({
        lineId: node.key,
        name: value.name ?? '',
        quantity,
        unitCode: value.unitCode ?? 'C62',
        netUnitPrice,
        vatCategory: value.vatCategory ?? 'S',
        vatRate: new Decimal(value.vatRate ?? 0),
      })
      return
    }

    // section, ouvrage, proposition, option, variant : on descend
    const nodeQty = new Decimal(value.quantity ?? 1)
    const nodeDiscount = new Decimal(value.discountPercentage ?? 0)

    const newQtyFactor = qtyFactor.times(nodeQty)
    const newPriceFactor = priceFactor.times(
      new Decimal(1).minus(nodeDiscount.div(100))
    )

    for (const child of node.children) {
      walk(child, newQtyFactor, newPriceFactor)
    }
  }

  // Proposition racine : qtyFactor = 1 (pas de quantité propre), priceFactor = majoration globale.
  // La remise globale reste au niveau document (n'entre pas dans le prix de ligne).
  for (const child of tree.children) {
    walk(child, new Decimal(1), rootPriceFactor)
  }

  return result
}
