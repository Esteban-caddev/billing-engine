import { Node } from '../model'

/**
 * Helpers purs de navigation sur le type de nœud canonique (`Node`).
 *
 * Remplacent la partie « structure / prédicats » des classes `TreeNode` (front + back),
 * sans état, sans framework, sans back-pointer `parent` (on le dérive à la demande).
 * cf. doc/moteur-calcul-partage.md §2.
 */

export const isCommentary = (n: Node): boolean =>
  n.value.nodeType === 'commentary'

/** Tout sauf un commentaire porte des montants. */
export const isMonetary = (n: Node): boolean => n.value.nodeType !== 'commentary'

export const isProduct = (n: Node): boolean => n.value.nodeType === 'product'

export const isProposition = (n: Node): boolean =>
  n.value.nodeType === 'proposition'

export const isSection = (n: Node): boolean => n.value.nodeType === 'section'

export const isOuvrage = (n: Node): boolean => n.value.nodeType === 'ouvrage'

/** Une variante/option non sélectionnée est exclue des calculs. */
export const isSelected = (n: Node): boolean =>
  n.value.variantOptionIsSelected !== false

/** Visite pré-ordre (parent avant enfants). */
export function walk(node: Node, visit: (n: Node) => void): void {
  visit(node)
  for (const child of node.children) walk(child, visit)
}

/** Visite post-ordre (enfants avant parent) — pour les agrégations. */
export function walkPostOrder(node: Node, visit: (n: Node) => void): void {
  for (const child of node.children) walkPostOrder(child, visit)
  visit(node)
}

/** Recherche par clé (DFS). */
export function findByKey(node: Node, key: string): Node | undefined {
  if (node.key === key) return node
  for (const child of node.children) {
    const found = findByKey(child, key)
    if (found) return found
  }
  return undefined
}

/** Parent dérivé à la demande (pas de back-pointer stocké). */
export function findParent(root: Node, key: string): Node | undefined {
  for (const child of root.children) {
    if (child.key === key) return root
    const found = findParent(child, key)
    if (found) return found
  }
  return undefined
}
