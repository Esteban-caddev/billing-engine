import { money } from '../config'
import {
  Node,
  NodeCost,
  NodeCostMargins,
  TreeBreakdown,
  TreeCostMargins,
} from '../model'
import { isMonetary, isProduct } from '../tree'
import { computeMargins } from './margins'

/**
 * Coûts & marges par nœud — HORS EN 16931. Port de `fillAdvancementCosts` /
 * `aggregateNodeCosts` du front, mais pur (renvoie une map, ne mute pas l'arbre).
 *
 *  - feuille produit : coût = coût de référence (devis) × (% d'avancement / 100) ;
 *  - nœud intermédiaire : somme des coûts enfants (taux horaire = moyenne) ;
 *  - marges : à partir du HT situation du nœud (issu du breakdown) vs matière/revient.
 *
 * @param tree            arbre de référence (porte `value.cost` plein par feuille)
 * @param breakdown       montants situation par nœud (pour le HT remisé)
 * @param percentByNodeKey % saisi par feuille
 */
export function computeCosts(
  tree: Node,
  breakdown: TreeBreakdown,
  percentByNodeKey: Record<string, number>
): TreeCostMargins {
  const result: TreeCostMargins = {}
  const round2 = (n: number): number => money(n).toNumber()
  const sellHT = (key: string): number =>
    Object.values(breakdown[key]?.discountedPrice ?? {}).reduce(
      (acc, v) => acc + (v || 0),
      0
    )

  const fill = (node: Node): void => {
    if (isProduct(node)) {
      const ref = node.value.cost ?? {}
      const ratio = (percentByNodeKey[node.key] ?? 0) / 100
      const materialPrice = round2((ref.materialPrice ?? 0) * ratio)
      const costPrice = round2((ref.costPrice ?? 0) * ratio)
      const cost: NodeCost = {
        materialPrice,
        costPrice,
        laborCost: round2((ref.laborCost ?? 0) * ratio),
        workTime: round2((ref.workTime ?? 0) * ratio),
        hourlyRate: ref.hourlyRate ?? 0,
      }
      result[node.key] = {
        cost,
        margins: computeMargins(sellHT(node.key), materialPrice, costPrice),
      }
      return
    }

    if (!isMonetary(node)) return

    for (const child of node.children) fill(child)

    let materialPrice = 0
    let costPrice = 0
    let laborCost = 0
    let workTime = 0
    let hourlyRateSum = 0
    let childCount = 0
    for (const child of node.children) {
      if (!isMonetary(child)) continue
      const cm = result[child.key]
      if (!cm) continue
      materialPrice += cm.cost.materialPrice
      costPrice += cm.cost.costPrice
      laborCost += cm.cost.laborCost
      workTime += cm.cost.workTime
      hourlyRateSum += cm.cost.hourlyRate
      childCount++
    }

    const cost: NodeCost = {
      materialPrice: round2(materialPrice),
      costPrice: round2(costPrice),
      laborCost: round2(laborCost),
      workTime: round2(workTime),
      hourlyRate: childCount > 0 ? round2(hourlyRateSum / childCount) : 0,
    }
    const margins: NodeCostMargins['margins'] = computeMargins(
      sellHT(node.key),
      materialPrice,
      costPrice
    )
    result[node.key] = { cost, margins }
  }

  fill(tree)
  return result
}
