import { computeSituation } from '../breakdown/computeBreakdown'
import { computeDocument } from '../pipeline/computeDocument'
import { flattenTree } from '../pipeline/flattenTree'
import { SerializedNode, TreeBreakdown } from '../model'

/**
 * Régression : chaînage des notes de crédit (avoirs) sur une même facture.
 *
 * Reproduit le cas signalé : une facture à 50 % d'un marché (HT 111,11 / TTC 133,33),
 * avec prorata + garantie, que l'on annule à 100 % via DEUX notes de crédit de 50 %.
 *
 * Un avoir V3 = situation NÉGATIVE sur le cumul marché :
 *   avoir = breakdown(cum_before) − breakdown(cum_after)
 *
 * Pour que Σ avoirs = facture AU CENTIME (prorata + garantie + net inclus), il FAUT
 * chaîner : le `cum_before` d'un avoir doit être le `cum_after` de l'avoir précédent.
 * C'est exactement ce que fait l'avancement (situations) et le devis.
 *
 * Côté front (crm-client-admin), ce chaînage repose sur le fait que les avoirs déjà
 * créés sur la facture soient comptés dans le cumul (`marketRevertedTrees`). Quand ils
 * ne le sont pas (avoirs « cancel » / ignoreInvoice=false filtrés), tous les avoirs
 * partent du même `cum_before` -> les deltas ne télescopent plus -> dérive au centime.
 */
describe('computeSituation — chaînage des notes de crédit (avoir cumul-delta)', () => {
  // Marché : 1 produit HT 111,11 (TVA 20 %) -> TTC 133,33.
  function market(): SerializedNode {
    return {
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
                sellPrice: 111.11,
                quantity: 1,
                vatRate: 20,
                vatRateId: 'vat20',
                vatCategory: 'S',
              },
              children: [],
            },
          ],
        },
      ],
    }
  }

  const PARAMS = { prorataPercentage: 0.05, garantiePercentage: 0.08 }
  const cum = (pct: number): Record<string, number> => ({ P1: pct })

  // Raccourci : totaux proposition d'un avoir/situation.
  const prop = (bd: TreeBreakdown) => {
    const m = bd['PROP']
    return {
      HT: m.finalHT,
      TTC: m.totalTTC,
      prorata: m.totalProrata ?? 0,
      garantie: m.totalGarantie ?? 0,
      net: m.netToPay ?? 0,
    }
  }
  const sum2 = (a: number, b: number) => Number((a + b).toFixed(2))

  it('le marché et la facture à 50 % ont les montants attendus', () => {
    const ref = market()
    const marketDoc = computeDocument(flattenTree(ref), PARAMS)
    expect(marketDoc.summation.taxExclusive.toNumber()).toBe(111.11)
    expect(marketDoc.summation.taxInclusive.toNumber()).toBe(133.33)

    const invoice = prop(computeSituation(ref, cum(50), cum(0), PARAMS))
    expect(invoice).toEqual({
      HT: 55.56,
      TTC: 66.67,
      prorata: 0.03,
      garantie: 0.05,
      net: 66.59,
    })
  })

  it('CHAÎNÉ (correct) : Σ des 2 avoirs = la facture AU CENTIME (prorata + garantie + net)', () => {
    const ref = market()
    const invoice = prop(computeSituation(ref, cum(50), cum(0), PARAMS))

    // NC1 crédite 50 % de la facture (50 % marché -> 25 %), NC2 chaîne sur le cumul de NC1
    // (25 % -> 0 %). cum_before(NC2) = cum_after(NC1).
    const nc1 = prop(computeSituation(ref, cum(50), cum(25), PARAMS))
    const nc2 = prop(computeSituation(ref, cum(25), cum(0), PARAMS))

    expect(sum2(nc1.HT, nc2.HT)).toBe(invoice.HT)
    expect(sum2(nc1.TTC, nc2.TTC)).toBe(invoice.TTC)
    expect(sum2(nc1.prorata, nc2.prorata)).toBe(invoice.prorata)
    expect(sum2(nc1.garantie, nc2.garantie)).toBe(invoice.garantie)
    expect(sum2(nc1.net, nc2.net)).toBe(invoice.net) // 66,59 = télescopage exact
  })

  it('NON CHAÎNÉ (bug) : 2 avoirs partant du même cum_before dérivent du centime', () => {
    const ref = market()
    const invoice = prop(computeSituation(ref, cum(50), cum(0), PARAMS))

    // Le bug : NC2 ne tient pas compte de NC1, les deux partent de cum_before = 50 %.
    const nc1 = prop(computeSituation(ref, cum(50), cum(25), PARAMS))
    const nc2 = prop(computeSituation(ref, cum(50), cum(25), PARAMS))

    // Les deux avoirs sont strictement identiques (symptôme observé en prod).
    expect(nc2).toEqual(nc1)

    // Le HT, lui, retombe juste (linéaire), ce qui masque le bug...
    expect(sum2(nc1.HT, nc2.HT)).toBe(invoice.HT)

    // ... mais prorata, garantie et net à payer NE somment PAS à la facture : c'est la dérive.
    expect(sum2(nc1.prorata, nc2.prorata)).not.toBe(invoice.prorata) // 0,04 ≠ 0,03
    expect(sum2(nc1.garantie, nc2.garantie)).not.toBe(invoice.garantie) // 0,04 ≠ 0,05
    expect(sum2(nc1.net, nc2.net)).not.toBe(invoice.net) // 66,58 ≠ 66,59
  })
})