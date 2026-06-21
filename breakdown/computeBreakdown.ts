import { Decimal, money } from '../config'
import {
  ComputedLine,
  DocumentParams,
  EN16931Document,
  Node,
  NodeMonetary,
  TreeBreakdown,
} from '../model'
import { applyBilling } from '../pipeline/applyBilling'
import { computeDocument } from '../pipeline/computeDocument'
import { flattenTree } from '../pipeline/flattenTree'
import { isMonetary, isProduct, walk } from '../tree'

/**
 * Breakdown : projette un document EN 16931 sur CHAQUE nœud de l'arbre (par `node.key`),
 * + dérive le % d'avancement des nœuds parents.
 *
 * C'est la SEULE source de la transformation « document -> valeurs par nœud ». Avant,
 * cette logique vivait côté front (`fillMonetaryFromLines` / `applyDocumentToProposition`
 * / `derivePercentages`) et aurait dû être redupliquée côté back -> divergence. Ici elle
 * est partagée et pure. cf. doc/moteur-calcul-partage.md §2.8.
 *
 * Règles (identiques à l'ancien front) :
 *  - feuille produit : montants de sa ligne (déjà foldés + arrondis BT-131) ;
 *  - nœud intermédiaire : SOMME des enfants (la quantité du nœud est déjà fondue dans
 *    les feuilles -> pas de re-multiplication) ;
 *  - proposition : écrasée par les totaux document (remise globale, TVA par groupe,
 *    prorata, garantie, net à payer) ;
 *  - % d'un parent = round(HT situation / HT devis × 100, 2) ; % d'une feuille = saisie.
 */

const round2 = (n: number): number => money(n).toNumber()

const sumValues = (rec?: Record<string, number>): number =>
  Object.values(rec ?? {}).reduce((acc, v) => acc + (v || 0), 0)

const addInto = (
  target: Record<string, number>,
  source: Record<string, number>
): void => {
  for (const [key, value] of Object.entries(source)) {
    target[key] = round2((target[key] ?? 0) + value)
  }
}

const zeroMonetary = (): NodeMonetary => ({
  unitPrice: {},
  totalPrice: {},
  discountedPrice: {},
  totalHT: 0,
  finalHT: 0,
  totalTTC: 0,
  finalTTC: 0,
  totalGlobalDiscount: 0,
  displayValues: {},
})

/** vatRateId d'une feuille : porté par l'app, fallback sur le taux. */
const leafVatRateId = (node: Node, rate: Decimal): string =>
  node.value.vatRateId ?? rate.toString()

/**
 * Table taux(number) -> vatRateId, reconstruite depuis les feuilles. Sert à keyer la
 * sortie de la proposition (dont le vatBreakdown moteur ne donne que des taux).
 */
export function buildRateToVatRateId(tree: Node): Record<string, string> {
  const acc: Record<string, string> = {}
  walk(tree, (n) => {
    if (!isProduct(n)) return
    const rate = n.value.vatRate
    const id = n.value.vatRateId
    if (rate != null && id != null && acc[rate] == null) acc[String(rate)] = id
  })
  return acc
}

/** Remplit récursivement (post-ordre) les montants par nœud depuis les lignes. */
function fillNode(
  node: Node,
  lineById: Map<string, ComputedLine>,
  map: TreeBreakdown
): void {
  if (isProduct(node)) {
    const line = lineById.get(node.key)
    if (!line) {
      // Produit non retenu (variante/option non sélectionnée) -> pas de ligne moteur.
      map[node.key] = zeroMonetary()
      return
    }
    const vatRateId = leafVatRateId(node, line.vatRate)
    const net = round2(line.netAmount.toNumber())
    const unit = line.netUnitPrice.toNumber() // BT-146 exact, non arrondi
    const rate = line.vatRate.toNumber()
    const tva = round2((net * rate) / 100)
    map[node.key] = {
      unitPrice: { [vatRateId]: unit },
      totalPrice: { [vatRateId]: net },
      discountedPrice: { [vatRateId]: net },
      totalHT: net,
      finalHT: net,
      totalTTC: round2(net + tva),
      finalTTC: round2(net + tva),
      totalGlobalDiscount: 0,
      displayValues: rate ? { [String(rate)]: tva } : {},
    }
    return
  }

  if (!isMonetary(node)) return // commentaire : rien

  for (const child of node.children) fillNode(child, lineById, map)

  const totalPrice: Record<string, number> = {}
  const displayValues: Record<string, number> = {}
  let totalHT = 0
  let totalTTC = 0
  for (const child of node.children) {
    if (!isMonetary(child)) continue
    const cm = map[child.key]
    if (!cm) continue
    addInto(totalPrice, cm.totalPrice)
    addInto(displayValues, cm.displayValues)
    totalHT = round2(totalHT + cm.totalHT)
    totalTTC = round2(totalTTC + cm.totalTTC)
  }

  map[node.key] = {
    unitPrice: { ...totalPrice },
    totalPrice,
    discountedPrice: { ...totalPrice },
    totalHT,
    finalHT: totalHT,
    totalTTC,
    finalTTC: totalTTC,
    totalGlobalDiscount: 0,
    displayValues,
  }
}

/** Écrase la proposition (racine) avec les totaux document EN 16931 + retenues BTP. */
function applyDocToProposition(
  tree: Node,
  doc: EN16931Document,
  rateToVatRateId: Record<string, string>,
  map: TreeBreakdown
): void {
  const { summation, vatBreakdown, retainage } = doc
  const vatRate: Record<string, number> = {}
  const discountedPrice: Record<string, number> = {}
  const displayValues: Record<string, number> = {}

  for (const group of vatBreakdown) {
    const rate = group.vatRate.toNumber()
    const vatRateId = rateToVatRateId[String(rate)] ?? String(rate)
    vatRate[vatRateId] = round2((vatRate[vatRateId] ?? 0) + group.taxAmount.toNumber())
    discountedPrice[vatRateId] = round2(
      (discountedPrice[vatRateId] ?? 0) + group.taxableAmount.toNumber()
    )
    displayValues[String(rate)] = round2(
      (displayValues[String(rate)] ?? 0) + group.taxAmount.toNumber()
    )
  }

  map[tree.key] = {
    unitPrice: { ...discountedPrice },
    totalPrice: { ...discountedPrice },
    discountedPrice,
    vatRate,
    displayValues,
    totalHT: summation.lineNetTotal.toNumber(),
    finalHT: summation.taxExclusive.toNumber(),
    totalGlobalDiscount: summation.allowanceTotal.toNumber(),
    totalTTC: summation.taxInclusive.toNumber(),
    finalTTC: summation.taxInclusive.toNumber(),
    totalProrata: retainage.prorataAmount.toNumber(),
    totalGarantie: retainage.garantieAmount.toNumber(),
    netToPay: retainage.netToCollect.toNumber(),
  }
}

/** Montants par nœud pour UN document (proposition = racine `tree`). */
export function computeNodeMonetary(
  tree: Node,
  doc: EN16931Document,
  rateToVatRateId: Record<string, string> = buildRateToVatRateId(tree)
): TreeBreakdown {
  const lineById = new Map(doc.lines.map((l) => [l.lineId, l]))
  const map: TreeBreakdown = {}
  fillNode(tree, lineById, map)
  applyDocToProposition(tree, doc, rateToVatRateId, map)
  return map
}

/**
 * Breakdown complet d'une situation : montants par nœud + % dérivé des parents.
 *
 * @param tree            arbre de référence (devis) — structure + vatRateId + taux
 * @param situationDoc    document de la situation (lignes devis × % d'avancement)
 * @param referenceDoc    document du devis (mode 'full') — base du % dérivé
 * @param percentByNodeKey % saisi par feuille
 * @param preserveNodeKey  nœud dont le % ne doit PAS être dérivé (le caller le conserve)
 */
export function computeBreakdown(
  tree: Node,
  situationDoc: EN16931Document,
  referenceDoc: EN16931Document,
  percentByNodeKey: Record<string, number>,
  preserveNodeKey?: string
): TreeBreakdown {
  const rateMap = buildRateToVatRateId(tree)
  const situation = computeNodeMonetary(tree, situationDoc, rateMap)
  const reference = computeNodeMonetary(tree, referenceDoc, rateMap)

  walk(tree, (node) => {
    const m = situation[node.key]
    if (!m) return
    if (isProduct(node)) {
      m.percentage = round2(percentByNodeKey[node.key] ?? 0)
      return
    }
    if (node.key === preserveNodeKey) return // % conservé par le caller
    const refHT = sumValues(reference[node.key]?.discountedPrice)
    const curHT = sumValues(m.discountedPrice)
    m.percentage = refHT === 0 ? 0 : round2((curHT / refHT) * 100)
  })

  return situation
}

/** Soustraction d'un Record (cum − précédent), sur l'union des clés. */
const subRec = (
  a: Record<string, number> = {},
  b: Record<string, number> = {}
): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    out[k] = round2((a[k] ?? 0) - (b[k] ?? 0))
  }
  return out
}

/**
 * Montants d'une PÉRIODE = cumulatif − cumulatif précédent, par nœud.
 *
 * Le prix unitaire d'une FEUILLE (BT-146) est le PU plein, identique entre deux cumuls :
 * on le garde tel quel (pas de delta). Pour un nœud parent, `unitPrice` est un montant
 * agrégé -> il se soustrait comme le reste.
 */
function subtractMonetary(
  cum: NodeMonetary,
  prev: NodeMonetary,
  isLeaf: boolean
): NodeMonetary {
  const out: NodeMonetary = {
    unitPrice: isLeaf ? { ...cum.unitPrice } : subRec(cum.unitPrice, prev.unitPrice),
    totalPrice: subRec(cum.totalPrice, prev.totalPrice),
    discountedPrice: subRec(cum.discountedPrice, prev.discountedPrice),
    totalHT: round2(cum.totalHT - prev.totalHT),
    finalHT: round2(cum.finalHT - prev.finalHT),
    totalTTC: round2(cum.totalTTC - prev.totalTTC),
    finalTTC: round2(cum.finalTTC - prev.finalTTC),
    totalGlobalDiscount: round2(cum.totalGlobalDiscount - prev.totalGlobalDiscount),
    displayValues: subRec(cum.displayValues, prev.displayValues),
  }
  if (cum.vatRate || prev.vatRate) out.vatRate = subRec(cum.vatRate, prev.vatRate)
  if (cum.totalProrata !== undefined || prev.totalProrata !== undefined)
    out.totalProrata = round2((cum.totalProrata ?? 0) - (prev.totalProrata ?? 0))
  if (cum.totalGarantie !== undefined || prev.totalGarantie !== undefined)
    out.totalGarantie = round2((cum.totalGarantie ?? 0) - (prev.totalGarantie ?? 0))
  if (cum.netToPay !== undefined || prev.netToPay !== undefined)
    out.netToPay = round2((cum.netToPay ?? 0) - (prev.netToPay ?? 0))
  return out
}

/**
 * Breakdown d'une SITUATION (avancement / échéance) = différence de deux cumuls, chacun
 * arrondi une seule fois :
 *
 *   situation = breakdown(devis × %_cumulé) − breakdown(devis × %_cumulé précédent)
 *
 * Garantit Σ situations = marché AU CENTIME par construction (les cumuls se télescopent :
 * Σ = breakdown(cumul final) − breakdown(0)). Plus aucune dérive d'arrondi, aucune
 * facture de solde à créer. Couvre avancement ET échéancier (cumuls = N/X).
 * cf. doc/moteur-calcul-partage.md §2.4 et la décision « deltas de cumul ».
 *
 * @param tree                  arbre de référence (marché) — structure + vatRateId + cost
 * @param cumulativePercentByKey % CUMULÉ par feuille jusqu'à CETTE situation incluse
 * @param previousPercentByKey   % CUMULÉ par feuille des situations PRÉCÉDENTES
 * @param params                 DocumentParams (remise globale, prorata, garantie…)
 * @param preserveNodeKey        nœud dont le % n'est pas redérivé (conservé par le caller)
 */
export function computeSituation(
  tree: Node,
  cumulativePercentByKey: Record<string, number>,
  previousPercentByKey: Record<string, number>,
  params: DocumentParams = {},
  preserveNodeKey?: string
): TreeBreakdown {
  const lines = flattenTree(tree)
  const rateMap = buildRateToVatRateId(tree)

  const referenceDoc = computeDocument(lines, params) // marché 100 %
  const cumDoc = computeDocument(
    applyBilling(lines, {
      mode: 'advancement',
      percentByNodeKey: cumulativePercentByKey,
    }),
    params
  )
  const prevDoc = computeDocument(
    applyBilling(lines, {
      mode: 'advancement',
      percentByNodeKey: previousPercentByKey,
    }),
    params
  )

  const reference = computeNodeMonetary(tree, referenceDoc, rateMap)
  const cum = computeNodeMonetary(tree, cumDoc, rateMap)
  const prev = computeNodeMonetary(tree, prevDoc, rateMap)

  const period: TreeBreakdown = {}
  walk(tree, (node) => {
    const c = cum[node.key]
    const p = prev[node.key]
    if (!c || !p) return
    period[node.key] = subtractMonetary(c, p, isProduct(node))
  })

  // % par nœud = HT période / HT marché (feuille : % période = cumul − précédent).
  walk(tree, (node) => {
    const m = period[node.key]
    if (!m) return
    if (isProduct(node)) {
      m.percentage = round2(
        (cumulativePercentByKey[node.key] ?? 0) -
          (previousPercentByKey[node.key] ?? 0)
      )
      return
    }
    if (node.key === preserveNodeKey) return
    const refHT = sumValues(reference[node.key]?.discountedPrice)
    const curHT = sumValues(m.discountedPrice)
    m.percentage = refHT === 0 ? 0 : round2((curHT / refHT) * 100)
  })

  return period
}
