/**
 * @neven-crm/billing-engine — moteur de calcul EN 16931 / BTP (pur, Decimal.js).
 *
 * Pipeline : flattenTree -> applyBilling -> computeDocument (-> toDisplay).
 * Docs : doc/analyse.md, doc/facturation-btp.md, doc/moteur-calcul-partage.md,
 *        doc/billing-engine-structure.md, doc/libs-validation-en16931.md
 */
export * from './config'
export * from './model'
export { flattenTree } from './pipeline/flattenTree'
export { applyBilling } from './pipeline/applyBilling'
export { computeDocument } from './pipeline/computeDocument'
export { toDisplay } from './display/toDisplay'
export { checkInvariants } from './invariants/invariants'
export type { Violation } from './invariants/invariants'
export { treeToSerialized } from './adapter/treeToSerialized'
export type { LegacyNode } from './adapter/treeToSerialized'
export * from './tree'
export {
  computeBreakdown,
  computeSituation,
  computeNodeMonetary,
  buildRateToVatRateId,
} from './breakdown/computeBreakdown'
export { computeCosts } from './costs/computeCosts'
export { computeMargins } from './costs/margins'
