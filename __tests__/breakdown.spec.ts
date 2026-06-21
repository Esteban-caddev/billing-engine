import { applyBilling } from '../pipeline/applyBilling'
import { computeDocument } from '../pipeline/computeDocument'
import { flattenTree } from '../pipeline/flattenTree'
import {
  computeBreakdown,
  computeSituation,
} from '../breakdown/computeBreakdown'
import { computeCosts } from '../costs/computeCosts'
import { SerializedNode } from '../model'
import { referenceTree } from './fixtures'

const PARAMS = { globalDiscountPercentage: 5 }

/** Devis (full) + situation (advancement 50 %) sur l'arbre golden. */
function docs(percent: number) {
  const ref = referenceTree()
  const lines = flattenTree(ref)
  const referenceDoc = computeDocument(lines, PARAMS)
  const percentByNodeKey = { A1: percent, A2: percent, B1: percent, B2: percent }
  const situationDoc = computeDocument(
    applyBilling(lines, { mode: 'advancement', percentByNodeKey }),
    PARAMS
  )
  return { ref, referenceDoc, situationDoc, percentByNodeKey }
}

describe('computeBreakdown — montants par nœud + % dérivé', () => {
  it('avancement 50 % : % de tous les parents dérivé à 50, montants par nœud cohérents', () => {
    const { ref, referenceDoc, situationDoc, percentByNodeKey } = docs(50)
    const bd = computeBreakdown(ref, situationDoc, referenceDoc, percentByNodeKey)

    // Proposition = totaux document de la situation (50 % du devis)
    expect(bd['PROP'].finalHT).toBe(689.7) // taxExclusive = 1379.40 / 2
    expect(bd['PROP'].totalHT).toBe(726) // lineNetTotal
    expect(bd['PROP'].totalGlobalDiscount).toBe(36.3)
    expect(bd['PROP'].totalTTC).toBe(817.19)
    expect(bd['PROP'].percentage).toBe(50)

    // Sections : HT = somme des feuilles, % dérivé du ratio HT situation/devis
    expect(bd['A'].totalHT).toBe(396) // 297 + 99
    expect(bd['A'].percentage).toBe(50)
    expect(bd['B'].totalHT).toBe(330) // 110 + 220
    expect(bd['B'].percentage).toBe(50)

    // Feuilles : montant net de la ligne (keyé par taux faute de vatRateId), % = saisie
    expect(bd['A1'].discountedPrice['20']).toBe(297)
    expect(bd['A1'].percentage).toBe(50)
    expect(bd['B1'].discountedPrice['10']).toBe(110)
  })

  it('avancement 100 % reproduit le devis (Σ situations = marché)', () => {
    const { ref, referenceDoc, situationDoc, percentByNodeKey } = docs(100)
    const bd = computeBreakdown(ref, situationDoc, referenceDoc, percentByNodeKey)
    expect(bd['PROP'].finalHT).toBe(1379.4)
    expect(bd['PROP'].totalTTC).toBe(1634.38)
    expect(bd['PROP'].percentage).toBe(100)
    expect(bd['A'].percentage).toBe(100)
    expect(bd['B'].percentage).toBe(100)
  })

  it('preserveNodeKey : le nœud préservé ne reçoit pas de % dérivé', () => {
    const { ref, referenceDoc, situationDoc, percentByNodeKey } = docs(50)
    const bd = computeBreakdown(ref, situationDoc, referenceDoc, percentByNodeKey, 'A')
    expect(bd['A'].percentage).toBeUndefined()
    expect(bd['B'].percentage).toBe(50) // les autres restent dérivés
  })
})

describe('computeSituation — deltas de cumul (Σ situations = marché)', () => {
  const LEAVES = ['A1', 'A2', 'B1', 'B2']
  const cum = (pct: number): Record<string, number> =>
    Object.fromEntries(LEAVES.map((k) => [k, pct]))

  // Marché golden : HT 1379,40 / TTC 1634,38 (cf. fixtures).
  it('3 situations cumulées (33,33 / 66,66 / 100) somment EXACTEMENT au marché', () => {
    const ref = referenceTree()
    const params = { globalDiscountPercentage: 5 }

    const s1 = computeSituation(ref, cum(33.33), cum(0), params)
    const s2 = computeSituation(ref, cum(66.66), cum(33.33), params)
    const s3 = computeSituation(ref, cum(100), cum(66.66), params)

    const sumHT = s1['PROP'].finalHT + s2['PROP'].finalHT + s3['PROP'].finalHT
    const sumTTC =
      s1['PROP'].totalTTC + s2['PROP'].totalTTC + s3['PROP'].totalTTC

    // Au centime, pas de dérive : c'est toute la promesse du cumul-delta.
    expect(Number(sumHT.toFixed(2))).toBe(1379.4)
    expect(Number(sumTTC.toFixed(2))).toBe(1634.38)

    // Idem au niveau d'une section (Σ deltas = HT marché de la section).
    const sumSectionA =
      s1['A'].discountedPrice['20'] +
      s2['A'].discountedPrice['20'] +
      s3['A'].discountedPrice['20']
    expect(Number(sumSectionA.toFixed(2))).toBe(792) // 594 + 198
  })

  it('la dernière situation absorbe le résidu (et reste un montant propre)', () => {
    const ref = referenceTree()
    const params = { globalDiscountPercentage: 5 }
    const s3 = computeSituation(ref, cum(100), cum(66.66), params)
    // solde HT = marché − cumul(66,66 %) ; le % dérivé est cohérent (~33,34 %).
    expect(s3['PROP'].finalHT).toBeGreaterThan(0)
    expect(s3['PROP'].percentage).toBeCloseTo(33.34, 1)
  })
})

describe('computeSituation — avoir (note de crédit en cumul-delta)', () => {
  const LEAVES = ['A1', 'A2', 'B1', 'B2']
  const cum = (pct: number): Record<string, number> =>
    Object.fromEntries(LEAVES.map((k) => [k, pct]))
  const params = { globalDiscountPercentage: 5 }

  // Un avoir V3 est calculé comme une situation NÉGATIVE sur le cumul marché :
  //   avoir = breakdown(cum_before) − breakdown(cum_after)   (= computeSituation(cum_before, cum_after))
  // où cum_after = cum_before − (part créditée). C'est exactement ce que produit le front
  // (billingEngineAdvancementV3.js) à partir de creditPercentage × advancementPercentage.

  it('avoir 100 % de la dernière situation = exactement cette situation', () => {
    const ref = referenceTree()
    // 2 situations : 0→40 % puis 40→70 %.
    const s2 = computeSituation(ref, cum(70), cum(40), params)
    // Avoir total de s2 : on retire toute la part facturée par s2 (cum 70 → 40).
    const avoir = computeSituation(ref, cum(70), cum(40), params)
    expect(avoir['PROP'].finalHT).toBe(s2['PROP'].finalHT)
    expect(avoir['PROP'].totalTTC).toBe(s2['PROP'].totalTTC)
    expect(avoir['PROP'].netToPay).toBe(s2['PROP'].netToPay)
  })

  it('Σ situations − avoir = cumul restant, au centime (télescopage)', () => {
    const ref = referenceTree()
    const s1 = computeSituation(ref, cum(40), cum(0), params)
    const s2 = computeSituation(ref, cum(70), cum(40), params)
    // Avoir partiel : crédite 50 % de s2 -> retire la moitié de (70−40), soit cum 70 → 55.
    const avoir = computeSituation(ref, cum(70), cum(55), params)
    // Après cet avoir, le cumul réellement facturé est 55 %.
    const remaining = computeSituation(ref, cum(55), cum(0), params)

    const netHT =
      s1['PROP'].finalHT + s2['PROP'].finalHT - avoir['PROP'].finalHT
    const netTTC =
      s1['PROP'].totalTTC + s2['PROP'].totalTTC - avoir['PROP'].totalTTC

    expect(Number(netHT.toFixed(2))).toBe(
      Number(remaining['PROP'].finalHT.toFixed(2))
    )
    expect(Number(netTTC.toFixed(2))).toBe(
      Number(remaining['PROP'].totalTTC.toFixed(2))
    )

    // Idem au niveau d'une section : Σ deltas − avoir = HT restant de la section.
    const sectionA =
      s1['A'].discountedPrice['20'] +
      s2['A'].discountedPrice['20'] -
      avoir['A'].discountedPrice['20']
    expect(Number(sectionA.toFixed(2))).toBe(
      Number(remaining['A'].discountedPrice['20'].toFixed(2))
    )
  })
})

describe('computeCosts — coûts & marges (hors EN 16931)', () => {
  const tree = (): SerializedNode => ({
    key: 'PROP',
    value: { nodeType: 'proposition' },
    children: [
      {
        key: 'S',
        value: { nodeType: 'section', quantity: 1 },
        children: [
          {
            key: 'P1',
            value: {
              nodeType: 'product',
              name: 'P1',
              sellPrice: 100,
              quantity: 1,
              vatRate: 20,
              vatRateId: 'vat20',
              cost: {
                materialPrice: 40,
                costPrice: 60,
                laborCost: 10,
                workTime: 2,
                hourlyRate: 5,
              },
            },
            children: [],
          },
        ],
      },
    ],
  })

  it('proratise le coût de référence par le % et calcule les marges sur le HT situation', () => {
    const t = tree()
    const lines = flattenTree(t)
    const referenceDoc = computeDocument(lines, {})
    const percentByNodeKey = { P1: 50 }
    const situationDoc = computeDocument(
      applyBilling(lines, { mode: 'advancement', percentByNodeKey }),
      {}
    )
    const bd = computeBreakdown(t, situationDoc, referenceDoc, percentByNodeKey)
    const costs = computeCosts(t, bd, percentByNodeKey)

    // Feuille : coût plein (40/60/10/2) × 0,5 ; HT situation = 50
    expect(costs['P1'].cost.materialPrice).toBe(20)
    expect(costs['P1'].cost.costPrice).toBe(30)
    expect(costs['P1'].cost.laborCost).toBe(5)
    expect(costs['P1'].cost.workTime).toBe(1)
    expect(costs['P1'].cost.hourlyRate).toBe(5)
    expect(costs['P1'].margins.marginBrut).toBe(30) // 50 − 20
    expect(costs['P1'].margins.marginBrutPercentage).toBe(60)
    expect(costs['P1'].margins.marginNet).toBe(20) // 50 − 30
    expect(costs['P1'].margins.marginNetPercentage).toBe(40)

    // Agrégation : section et proposition somment les coûts enfants
    expect(costs['S'].cost.materialPrice).toBe(20)
    expect(costs['PROP'].cost.costPrice).toBe(30)
    expect(costs['PROP'].margins.marginBrut).toBe(30)
  })
})
