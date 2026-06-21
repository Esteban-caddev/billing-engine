import { computeDocument } from '../pipeline/computeDocument'
import { flattenTree } from '../pipeline/flattenTree'
import { LegacyNode, treeToSerialized } from '../adapter/treeToSerialized'

/**
 * Adaptateur arbre métier (forme réelle de l'app) -> SerializedNode (moteur).
 * Le fixture imite la VRAIE forme des nœuds : Product.sellPrice, VatRate.ratePercentage, vatRateId, Unit.
 * Reprend l'exemple de doc/analyse.md §4 (golden 1 379,40 / 1 634,38).
 * ROUGE tant que treeToSerialized n'est pas implémenté.
 */
const legacyTree: LegacyNode = {
  key: 'root',
  value: { nodeType: 'root' },
  children: [
    {
      key: 'PROP',
      value: {
        nodeType: 'proposition',
        globalMajorationPercentage: 10,
        globalDiscountPercentage: 5,
      },
      children: [
        {
          key: 'A',
          value: { nodeType: 'section', quantity: 2, discountPercentage: 10 },
          children: [
            { key: 'A1', value: { nodeType: 'product', name: 'A1', quantity: 3, vatRateId: 'V20', Product: { sellPrice: 100 }, VatRate: { ratePercentage: 20 }, Unit: { code: 'C62' } }, children: [] },
            { key: 'A2', value: { nodeType: 'product', name: 'A2', quantity: 2, vatRateId: 'V20', Product: { sellPrice: 50 }, VatRate: { ratePercentage: 20 } }, children: [] },
          ],
        },
        {
          key: 'B',
          value: { nodeType: 'section', quantity: 1, discountPercentage: 0 },
          children: [
            { key: 'B1', value: { nodeType: 'product', name: 'B1', quantity: 1, vatRateId: 'V10', Product: { sellPrice: 200 }, VatRate: { ratePercentage: 10 } }, children: [] },
            { key: 'B2', value: { nodeType: 'product', name: 'B2', quantity: 5, vatRateId: 'V20', Product: { sellPrice: 80 }, VatRate: { ratePercentage: 20 } }, children: [] },
          ],
        },
      ],
    },
  ],
}

describe('treeToSerialized — arbre métier (TreeNode) -> SerializedNode', () => {
  it('renvoie la proposition comme racine du moteur', () => {
    const s = treeToSerialized(legacyTree)
    expect(s.value.nodeType).toBe('proposition')
    expect(s.value.globalMajorationPercentage).toBe(10)
    expect(s.value.globalDiscountPercentage).toBe(5)
  })

  it('mappe Product.sellPrice -> sellPrice et VatRate.ratePercentage -> vatRate', () => {
    const s = treeToSerialized(legacyTree)
    const a1 = s.children[0].children[0]
    expect(a1.value.nodeType).toBe('product')
    expect(a1.value.sellPrice).toBe(100)
    expect(a1.value.vatRate).toBe(20)
  })

  it('défaut catégorie TVA = S et unité = C62 quand absents', () => {
    const s = treeToSerialized(legacyTree)
    const a2 = s.children[0].children[1] // A2 n'a pas d'Unit
    expect(a2.value.vatCategory).toBe('S')
    expect(a2.value.unitCode).toBe('C62')
  })

  it('adapter + moteur reproduit le golden (BT-109 1 379,40 / BT-111 1 634,38)', () => {
    const s = treeToSerialized(legacyTree)
    const doc = computeDocument(flattenTree(s), {
      globalDiscountPercentage: s.value.globalDiscountPercentage,
    })
    expect(doc.summation.taxExclusive.toFixed(2)).toBe('1379.40')
    expect(doc.summation.taxInclusive.toFixed(2)).toBe('1634.38')
  })
})
