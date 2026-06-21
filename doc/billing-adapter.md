# Bridge arbre métier → moteur (`billing-adapter`)

> S'appuie sur `doc/billing-engine-structure.md` (frontière du moteur) et `doc/analyse.md` (mapping EN 16931).
> Décrit comment adapter les `TreeNode` de l'app vers les types d'entrée du moteur, et pourquoi extraire un package `@neven-crm/billing-adapter` séparé.

---

## 1. La frontière : deux mondes distincts

Le moteur `@neven-crm/billing-engine` n'accepte que des **objets plats sérialisables** (`SerializedNode` / `NodeValue`). Il ne connaît pas la forme réelle des nœuds de l'app.

```
Arbre métier (app)                        @neven-crm/billing-engine
──────────────────                        ─────────────────────────
TreeNode / TreeNodeValue                  SerializedNode / NodeValue
  .value.Product.sellPrice       →          .value.sellPrice
  .value.VatRate.ratePercentage  →          .value.vatRate
  .value.VatRate.category        →          .value.vatCategory   ← BT-151
  .value.Unit.code               →          .value.unitCode      ← BT-130
  .value.vatRateId               →          (non transmis — identifiant interne)
```

La fonction `treeToSerialized` (dans `adapter/treeToSerialized.ts`) est le **seul endroit** où l'on touche aux formes réelles de l'app.

---

## 2. Ce que fait `treeToSerialized`

```ts
// adapter/treeToSerialized.ts

function convertNode(node: LegacyNode): SerializedNode {
  const product = node.value.Product as { sellPrice?: number }
  const vatRate  = node.value.VatRate as { ratePercentage?: number; category?: string }
  const unit     = node.value.Unit    as { code?: string }

  return {
    key: node.key,
    value: {
      nodeType:   node.value.nodeType,
      name:       node.value.name,
      quantity:   node.value.quantity,
      discountPercentage:         node.value.discountPercentage,
      globalDiscountPercentage:   node.value.globalDiscountPercentage,
      globalMajorationPercentage: node.value.globalMajorationPercentage,
      variantOptionIsSelected:    node.value.variantOptionIsSelected,
      // ─── Dé-nesting des relations ────────────────────────────────────
      sellPrice:   product?.sellPrice,           // Product.sellPrice → BT-148/146
      vatRate:     vatRate?.ratePercentage,       // VatRate.ratePercentage → BT-152
      vatCategory: vatRate?.category ?? 'S',     // VatRate.category → BT-151 ⚠️ voir §4
      unitCode:    unit?.code ?? 'C62',          // Unit.code → BT-130, défaut UNECE "unité"
    },
    children: node.children.map(convertNode),
  }
}

export function treeToSerialized(tree: LegacyNode): SerializedNode {
  // Si on lui passe la racine technique (nodeType 'root'), on saute sur la proposition
  const root = tree.value.nodeType === 'root' ? tree.children[0] : tree
  return convertNode(root)
}
```

Puis `flattenTree` prend ce `SerializedNode` et produit une **liste plate de lignes EN 16931** en multipliant quantités et remises à travers toute la hiérarchie :

```
BT-129 (quantité effective) = qty_produit × qty_section × qty_ouvrage × …
BT-146 (prix net)           = sellPrice × (1 + majGlobale) × Π(1 − remise_ancêtre) × (1 − remise_produit)
BT-131 (montant net ligne)  = BT-129 × BT-146    ← UN SEUL arrondi, ici
```

> La **remise globale** (`globalDiscountPercentage`) reste au niveau document (BG-20) : elle **n'entre pas** dans BT-146. Elle est appliquée par `computeDocument` sous forme d'`AllowanceCharge` par groupe TVA.

---

## 3. Flux complet (front et back)

```
TreeNode (front ou back)
    │
    ▼  treeToSerialized(node)                 ← adapter (pont app ↔ moteur)
SerializedNode
    │
    ▼  flattenTree(serialized)                ← billing-engine
FlatLine[]
    │
    ▼  applyBilling(lines, billingInput)      ← mode: full | advancement | deposit
FlatLine[] avec % appliqués
    │
    ▼  computeDocument(lines, documentParams) ← billing-engine
EN16931Document
    │
    ├──► toDisplay()                          ← PDF / écran
    └──► stocké en base avec calculationVersion
```

`documentParams` (remise/majoration globale, prorata, garantie, bankGuaranty) vient de `PaymentCondition` — voir §5.

---

## 4. Problème actuel : `vatCategory` absent de l'entité `VatRate`

EN 16931 exige le code BT-151 pour chaque ligne : `S` (standard), `Z` (taux zéro), `E` (exonéré), `AE` (autoliquidation)…

L'entité actuelle ne porte **pas** ce champ :

```ts
// vat-rate.entity.ts — état actuel
class VatRate {
  ratePercentage: number   // ✅ utilisé → BT-152
  name: string
  label?: string
  // category?: string    ← ⚠️ absent → l'adaptateur met 'S' en dur
}
```

Pour les clients avec TVA à 0 % ou en autoliquidation, le code `'S'` sera faux et produira un document EN 16931 non conforme.

### Action requise

**1. Ajouter `category` à l'entité :**

```ts
export type VatCategory = 'S' | 'Z' | 'E' | 'AE' | 'K' | 'G' | 'O' | 'L' | 'M'

@Prop({ default: 'S' })
category: VatCategory
```

**2. Règle de dérivation en fallback (dans l'adaptateur) :**

```ts
export function vatCategoryCode(vr: { ratePercentage?: number; category?: string }): string {
  if (vr.category) return vr.category
  if ((vr.ratePercentage ?? 0) === 0) return 'Z'  // taux 0 % → taux zéro
  return 'S'                                        // standard par défaut
}
```

---

## 5. Pourquoi extraire un package `@neven-crm/billing-adapter`

L'adaptateur actuel vit dans `billing-engine/adapter/`. Le front (`crm-client-admin`) l'importe déjà (`treeToSerialized` dans `billingEngineV3.js`). À mesure que l'usage grandit, il vaut mieux isoler ce pont dans son propre package.

### Découpage logique

```
@neven-crm/billing-engine        ← moteur pur (règles EN 16931, decimal.js)
@neven-crm/billing-adapter       ← pont app ↔ moteur (à extraire)
```

| Critère | `billing-engine` | `billing-adapter` |
|---|---|---|
| Dépendances | `decimal.js` seulement | Connaît les types métier de l'app |
| Stabilité | Figé (règles EN 16931) | Évolue avec le modèle de données |
| Tests | Golden tests normatifs | Tests de conversion structurelle |
| Partageable sans contexte app | ✅ oui | Oui, mais couplé au modèle |

### Interface cible de l'adaptateur

```ts
// @neven-crm/billing-adapter

import type { SerializedNode, DocumentParams } from '@neven-crm/billing-engine'
import type { LegacyNode } from '@neven-crm/billing-engine'
import type { PaymentCondition } from '../entities/payment-condition.entity'

/** TreeNode (back ou front) → SerializedNode pour le moteur */
export function treeToSerialized(node: LegacyNode): SerializedNode

/** PaymentCondition → DocumentParams (prorata, garantie, bankGuaranty) */
export function fromPaymentCondition(
  pc: PaymentCondition
): Pick<DocumentParams, 'prorataPercentage' | 'garantiePercentage' | 'bankGuaranty'>

/** VatRate entity → code BT-151 EN 16931 */
export function vatCategoryCode(
  vatRate: { ratePercentage?: number; category?: string }
): string
```

### `fromPaymentCondition` — mapping `PaymentCondition` → `DocumentParams`

```ts
export function fromPaymentCondition(pc: PaymentCondition): Pick<
  DocumentParams,
  'prorataPercentage' | 'garantiePercentage' | 'bankGuaranty'
> {
  return {
    prorataPercentage: pc.isProrata ? (pc.prorataPercentage ?? 0) : 0,
    garantiePercentage: pc.isGarantie ? (pc.garantiePercentage ?? 0) : 0,
    bankGuaranty: pc.bankGuaranty ?? false,
  }
}
```

---

## 6. Récapitulatif des champs mappés

### Niveau ligne (1 ligne = 1 nœud `product` feuille)

| Champ `SerializedNode` | Source `TreeNodeValue` | BT EN 16931 |
|---|---|---|
| `sellPrice` | `value.Product.sellPrice` | BT-148 (base du prix article) |
| `vatRate` | `value.VatRate.ratePercentage` | BT-152 |
| `vatCategory` | `value.VatRate.category` (fallback §4) | BT-151 |
| `unitCode` | `value.Unit.code` (défaut `C62`) | BT-130 |
| `quantity` | `value.quantity` (multiplié par ancêtres dans `flattenTree`) | BT-129 |
| `discountPercentage` | `value.discountPercentage` | fondu dans BT-146 |
| `name` | `value.name` | BT-153 |
| `variantOptionIsSelected` | `value.variantOptionIsSelected` | (filtre : ligne ignorée si `false`) |

### Niveau document (nœud `proposition`)

| Champ `SerializedNode` | Source `TreeNodeValue` | Utilisation moteur |
|---|---|---|
| `globalDiscountPercentage` | `value.globalDiscountPercentage` | `AllowanceCharge` BG-20 par groupe TVA |
| `globalMajorationPercentage` | `value.globalMajorationPercentage` | fondu dans BT-146 (priceFactor) |
| `prorataPercentage` | `PaymentCondition.prorataPercentage` | `RetainageSummary.prorataAmount` |
| `garantiePercentage` | `PaymentCondition.garantiePercentage` | `RetainageSummary.garantieAmount` |
| `bankGuaranty` | `PaymentCondition.bankGuaranty` | si `true` → `garantieAmount = 0` |

### Concepts arbre sans équivalent natif EN 16931

| Concept | Stratégie d'aplatissement |
|---|---|
| Quantité de section/ouvrage | Multipliée dans BT-129 des lignes filles par `flattenTree` |
| Remise de section | Fondue dans BT-146 par `flattenTree` |
| Majoration globale | Fondue dans BT-146 (priceFactor = `1 + majGlobale / 100`) |
| Garantie / prorata | `RetainageSummary` hors BT-106..115 (voir `doc/facturation-btp.md §3`) |
| Arbre N niveaux | Aplati : 1 ligne par produit feuille |
