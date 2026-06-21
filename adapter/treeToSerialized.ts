import { NodeType, SerializedNode } from '../model'

/**
 * Adaptateur : arbre métier de l'app (TreeNode / TreeLike sérialisé)
 *   -> SerializedNode (entrée normalisée du moteur).
 *
 * Le moteur ne connaît PAS la forme réelle des nœuds de l'app (Product.sellPrice,
 * VatRate.ratePercentage, Unit, vatRateId…). C'est cet adaptateur qui fait le pont.
 * cf. doc/billing-engine-structure.md §1 (frontière) et la discussion TreeNode.
 *
 * Renvoie le nœud `proposition` comme racine du moteur : si on lui passe la racine
 * technique (nodeType 'root'), il descend sur son premier enfant.
 */
export interface LegacyNode {
  key: string
  // forme réelle des nœuds de l'app (champs optionnels imbriqués)
  value: Record<string, unknown>
  children: LegacyNode[]
}

function convertNode(node: LegacyNode): SerializedNode {
  const { value } = node

  const product = value.Product as { sellPrice?: number } | undefined
  const vatRate = value.VatRate as
    | { id?: string; _id?: string; ratePercentage?: number; category?: string }
    | undefined
  const unit = value.Unit as { code?: string } | undefined
  const cost = value.cost as
    | {
        materialPrice?: number
        costPrice?: number
        laborCost?: number
        workTime?: number
        hourlyRate?: number
      }
    | undefined

  return {
    key: node.key,
    value: {
      nodeType: value.nodeType as NodeType,
      name: value.name as string | undefined,
      quantity: value.quantity as number | undefined,
      discountPercentage: value.discountPercentage as number | undefined,
      globalDiscountPercentage: value.globalDiscountPercentage as number | undefined,
      globalMajorationPercentage: value.globalMajorationPercentage as number | undefined,
      variantOptionIsSelected: value.variantOptionIsSelected as boolean | undefined,
      sellPrice: product?.sellPrice,
      vatRate: vatRate?.ratePercentage,
      vatCategory: vatRate?.category ?? 'S',
      unitCode: unit?.code ?? 'C62',
      // identifiant TVA app (opaque) — pour keyer la sortie breakdown comme l'app
      vatRateId:
        (value.vatRateId as string | undefined) ?? vatRate?.id ?? vatRate?._id,
      // coûts (hors EN 16931) — pour le module costs/
      cost: cost
        ? {
            materialPrice: cost.materialPrice,
            costPrice: cost.costPrice,
            laborCost: cost.laborCost,
            workTime: cost.workTime,
            hourlyRate: cost.hourlyRate,
          }
        : undefined,
    },
    children: node.children.map(convertNode),
  }
}

export function treeToSerialized(tree: LegacyNode): SerializedNode {
  const root = tree.value.nodeType === 'root' ? tree.children[0] : tree
  return convertNode(root)
}
