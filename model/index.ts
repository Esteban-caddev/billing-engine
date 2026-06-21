import { Decimal } from '../config'

/* ===========================================================================
 * ENTRÉE — arbre métier sérialisé (objet plat, aucune classe ne franchit la frontière)
 * ======================================================================== */

export type NodeType =
  | 'proposition'
  | 'section'
  | 'ouvrage'
  | 'product'
  | 'commentary'
  | 'option'
  | 'variant'

export interface NodeValue {
  nodeType: NodeType
  name?: string
  quantity?: number
  // remises / majoration
  discountPercentage?: number // remise produit OU section
  globalDiscountPercentage?: number // remise globale (proposition) -> BG-20
  globalMajorationPercentage?: number // majoration globale (proposition)
  // produit
  sellPrice?: number // prix catalogue HT (base BT-148)
  vatRate?: number // taux TVA % -> BT-152 / BT-119
  vatCategory?: string // catégorie TVA -> BT-151 / BT-118 (S/Z/E/AE…)
  unitCode?: string // unité UNECE -> BT-130
  variantOptionIsSelected?: boolean
  // Identifiant TVA de l'app (opaque pour le moteur) : porté tel quel pour que la
  // sortie par nœud (breakdown) soit keyée comme côté app, sans que le moteur ait à
  // connaître la base de données. cf. breakdown/computeBreakdown.
  vatRateId?: string
  // Coûts d'achat/revient (HORS EN 16931) : entrée du module costs/.
  cost?: NodeCostInput
}

export interface SerializedNode {
  key: string
  value: NodeValue
  children: SerializedNode[]
}

/**
 * Type de nœud canonique du moteur. `Tree` et `TreeNode` côté apps ne sont qu'une
 * coquille (navigation / UI / persistance) autour de CE type sérialisable — c'est lui,
 * et lui seul, qui franchit la frontière. cf. doc/moteur-calcul-partage.md §2.
 */
export type Node = SerializedNode

/* ===========================================================================
 * SORTIE — document EN 16931 (plat, sérialisable, stockable)
 * ======================================================================== */

/** Ligne de facture — BG-25 */
export interface FlatLine {
  lineId: string // BT-126 Invoice line identifier
  name: string // BT-153 Item name
  quantity: Decimal // BT-129 Invoiced quantity
  unitCode: string // BT-130 Unit of measure (UNECE)
  netUnitPrice: Decimal // BT-146 Item net price (exact, NON arrondi)
  vatCategory: string // BT-151 Invoiced item VAT category code
  vatRate: Decimal // BT-152 Invoiced item VAT rate
}

/** Ligne calculée = ligne + montant net — BT-131 */
export interface ComputedLine extends FlatLine {
  netAmount: Decimal // BT-131 Invoice line net amount
}

/** Remise (BG-20) ou charge (BG-21) au niveau document */
export interface AllowanceCharge {
  isCharge: boolean
  amount: Decimal // BT-92 (remise) / BT-99 (charge)
  baseAmount?: Decimal // BT-93 / BT-100
  percentage?: Decimal // BT-94 / BT-101
  vatCategory: string // BT-95 / BT-102
  vatRate: Decimal // BT-96 / BT-103
  reason?: string // BT-97 / BT-104
  reasonCode?: string // BT-98 / BT-105
}

/** Ventilation TVA par (catégorie, taux) — BG-23 */
export interface VatGroup {
  vatCategory: string // BT-118 VAT category code
  vatRate: Decimal // BT-119 VAT category rate
  taxableAmount: Decimal // BT-116 VAT category taxable amount
  taxAmount: Decimal // BT-117 VAT category tax amount
}

/** Totaux du document — BG-22 */
export interface MonetarySummation {
  lineNetTotal: Decimal // BT-106 Sum of Invoice line net amount
  allowanceTotal: Decimal // BT-107 Sum of allowances on document level
  chargeTotal: Decimal // BT-108 Sum of charges on document level
  taxExclusive: Decimal // BT-109 Invoice total amount without VAT
  taxTotal: Decimal // BT-110 Invoice total VAT amount
  taxInclusive: Decimal // BT-111 Invoice total amount with VAT
  prepaid: Decimal // BT-112 Paid amount (acomptes piochés)
  rounding: Decimal // BT-113 Rounding amount
  payable: Decimal // BT-115 Amount due for payment
}

/**
 * Retenues BTP — HORS sommation EN 16931 (BT-106..115 restent standard).
 * netToCollect = BT-115 − prorata − garantie (le "net à payer" réel du BTP).
 * cf. doc/facturation-btp.md §3. Décision : prorata = retenue (soustrait).
 */
export interface RetainageSummary {
  prorataBase: Decimal // base HT (= BT-109)
  prorataPercentage: Decimal
  prorataAmount: Decimal // compte prorata retenu
  garantieBase: Decimal // base TTC (= BT-111)
  garantiePercentage: Decimal
  garantieAmount: Decimal // retenue de garantie (0 si caution bancaire)
  bankGuaranty: boolean
  netToCollect: Decimal // = BT-115 − prorata − garantie
}

/** Référence à une facture précédente — BG-3 */
export interface DocRef {
  id: string // BT-25 Preceding Invoice reference
  date?: string // BT-26 Preceding Invoice issue date
}

export interface EN16931Document {
  lines: ComputedLine[]
  documentAllowances: AllowanceCharge[]
  documentCharges: AllowanceCharge[]
  vatBreakdown: VatGroup[]
  summation: MonetarySummation
  retainage: RetainageSummary
  precedingInvoiceRefs: DocRef[]
  calculationVersion: string
}

/* ===========================================================================
 * Paramètres
 * ======================================================================== */

/* ---- Modèle d'affichage (PDF / écran) ---- */
export interface DisplayLine {
  lineId: string
  name: string
  quantity: string
  unitCode: string // BT-130
  unitPrice: string // BT-146, 4 décimales ("le montant de ligne fait foi")
  netAmount: string // BT-131, 2 décimales
  vatRate: string // BT-152
}

export interface DisplayModel {
  lines: DisplayLine[]
  totalHT: string // BT-109
  totalVAT: string // BT-110
  totalTTC: string // BT-111
  netToCollect: string // retenue BTP (= BT-115 − prorata − garantie)
}

export interface DisplayOptions {
  locale?: string // réservé (formatage UI fait côté app)
}

export interface FlattenOptions {
  /** majoration globale fondue dans BT-146 (défaut) ou exposée en charge document */
  globalMajorationAs?: 'price' | 'documentCharge'
}

export type BillingMode = 'full' | 'advancement' | 'deposit'

export interface BillingInput {
  mode: BillingMode
  /** % appliqué par clé de nœud (avancement / échéance) */
  percentByNodeKey?: Record<string, number>
}

export interface DocumentParams {
  globalDiscountPercentage?: number // BG-20 (remise document, par groupe TVA)
  // règles BTP
  prorataPercentage?: number // compte prorata
  garantiePercentage?: number // retenue de garantie
  bankGuaranty?: boolean // caution bancaire -> pas de retenue
  // paiements
  prepaid?: number // BT-112
  precedingInvoiceRefs?: DocRef[] // BG-3
  rounding?: number // BT-113
  calculationVersion?: string
}

/* ===========================================================================
 * SORTIE PAR NŒUD — breakdown (montants projetés sur chaque nœud de l'arbre)
 *
 * Le document EN 16931 raisonne en LIGNES + totaux. L'app, elle, affiche des montants
 * PAR NŒUD (section / ouvrage / proposition). Le breakdown est la transformation
 * « document -> valeurs par node.key », possédée par le moteur pour que front et back
 * projettent EXACTEMENT les mêmes nombres. cf. doc/moteur-calcul-partage.md §2.8.
 *
 * Les Record sont keyés par `vatRateId` (opaque app) sauf `displayValues` keyé par taux.
 * ======================================================================== */

export interface NodeMonetary {
  unitPrice: Record<string, number>
  totalPrice: Record<string, number>
  discountedPrice: Record<string, number> // HT exposé du nœud
  vatRate?: Record<string, number> // montant TVA par vatRateId (proposition)
  totalHT: number
  finalHT: number
  totalTTC: number
  finalTTC: number
  totalGlobalDiscount: number
  displayValues: Record<string, number> // montant TVA par TAUX
  // % d'avancement/d'avoir : saisi pour une feuille, DÉRIVÉ (HT situation / HT devis)
  // pour un nœud parent. `undefined` => le caller conserve la valeur existante.
  percentage?: number
  // proposition uniquement (retenues BTP)
  totalProrata?: number
  totalGarantie?: number
  netToPay?: number
}

export type TreeBreakdown = Record<string, NodeMonetary>

/* ===========================================================================
 * SORTIE PAR NŒUD — coûts & marges (HORS EN 16931, module costs/)
 * ======================================================================== */

export interface NodeCostInput {
  materialPrice?: number
  costPrice?: number
  laborCost?: number
  workTime?: number
  hourlyRate?: number
}

export interface NodeCost {
  materialPrice: number
  costPrice: number
  laborCost: number
  workTime: number
  hourlyRate: number
}

export interface NodeMargins {
  marginBrut: number
  marginNet: number
  marginBrutPercentage: number
  marginNetPercentage: number
}

export interface NodeCostMargins {
  cost: NodeCost
  margins: NodeMargins
}

export type TreeCostMargins = Record<string, NodeCostMargins>
