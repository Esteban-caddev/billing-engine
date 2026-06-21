import { Decimal } from '../config'
import { EN16931Document, NodeValue, SerializedNode } from '../model'

const node = (
  key: string,
  value: NodeValue,
  children: SerializedNode[] = []
): SerializedNode => ({ key, value, children })

/**
 * Arbre de référence — exemple de doc/analyse.md §4.
 *   Proposition : majoration globale 10 %, remise globale 5 %
 *   Section A (qté 2, remise 10 %) : A1 100€×3 TVA20 · A2 50€×2 TVA20
 *   Section B (qté 1, remise 0 %)  : B1 200€×1 TVA10 · B2 80€×5 TVA20
 */
export function referenceTree(): SerializedNode {
  return node(
    'PROP',
    {
      nodeType: 'proposition',
      globalMajorationPercentage: 10,
      globalDiscountPercentage: 5,
    },
    [
      node('A', { nodeType: 'section', quantity: 2, discountPercentage: 10 }, [
        node('A1', { nodeType: 'product', name: 'A1', sellPrice: 100, quantity: 3, vatRate: 20, vatCategory: 'S' }),
        node('A2', { nodeType: 'product', name: 'A2', sellPrice: 50, quantity: 2, vatRate: 20, vatCategory: 'S' }),
      ]),
      node('B', { nodeType: 'section', quantity: 1, discountPercentage: 0 }, [
        node('B1', { nodeType: 'product', name: 'B1', sellPrice: 200, quantity: 1, vatRate: 10, vatCategory: 'S' }),
        node('B2', { nodeType: 'product', name: 'B2', sellPrice: 80, quantity: 5, vatRate: 20, vatCategory: 'S' }),
      ]),
    ]
  )
}

const D = (n: number | string): Decimal => new Decimal(n)

/**
 * Document EN 16931 attendu pour referenceTree() en mode devis (100 %).
 * "Golden" partagé entre golden.spec et invariants.spec. Chiffres : doc/analyse.md §4.3.
 */
export function expectedDocument(): EN16931Document {
  return {
    lines: [
      { lineId: 'A1', name: 'A1', quantity: D(6), unitCode: 'C62', netUnitPrice: D('99'),   vatCategory: 'S', vatRate: D(20), netAmount: D('594.00') },
      { lineId: 'A2', name: 'A2', quantity: D(4), unitCode: 'C62', netUnitPrice: D('49.5'),  vatCategory: 'S', vatRate: D(20), netAmount: D('198.00') },
      { lineId: 'B1', name: 'B1', quantity: D(1), unitCode: 'C62', netUnitPrice: D('220'),   vatCategory: 'S', vatRate: D(10), netAmount: D('220.00') },
      { lineId: 'B2', name: 'B2', quantity: D(5), unitCode: 'C62', netUnitPrice: D('88'),    vatCategory: 'S', vatRate: D(20), netAmount: D('440.00') },
    ],
    documentAllowances: [
      { isCharge: false, amount: D('61.60'), baseAmount: D('1232.00'), percentage: D(5), vatCategory: 'S', vatRate: D(20), reason: 'Remise globale' },
      { isCharge: false, amount: D('11.00'), baseAmount: D('220.00'),  percentage: D(5), vatCategory: 'S', vatRate: D(10), reason: 'Remise globale' },
    ],
    documentCharges: [],
    vatBreakdown: [
      { vatCategory: 'S', vatRate: D(20), taxableAmount: D('1170.40'), taxAmount: D('234.08') },
      { vatCategory: 'S', vatRate: D(10), taxableAmount: D('209.00'),  taxAmount: D('20.90') },
    ],
    summation: {
      lineNetTotal: D('1452.00'), // BT-106
      allowanceTotal: D('72.60'), // BT-107
      chargeTotal: D('0.00'),     // BT-108
      taxExclusive: D('1379.40'), // BT-109
      taxTotal: D('254.98'),      // BT-110
      taxInclusive: D('1634.38'), // BT-111
      prepaid: D('0.00'),         // BT-112
      rounding: D('0.00'),        // BT-113
      payable: D('1634.38'),      // BT-115
    },
    retainage: {
      prorataBase: D('1379.40'),
      prorataPercentage: D(0),
      prorataAmount: D('0.00'),
      garantieBase: D('1634.38'),
      garantiePercentage: D(0),
      garantieAmount: D('0.00'),
      bankGuaranty: false,
      netToCollect: D('1634.38'),
    },
    precedingInvoiceRefs: [],
    calculationVersion: 'test',
  }
}
