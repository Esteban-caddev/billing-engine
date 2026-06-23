# LLM.md — Guide de contexte pour agents IA

> Ce fichier décrit le fonctionnement interne du billing-engine pour qu'un LLM puisse
> comprendre, modifier et déboguer le code SANS lire chaque fichier source.
> Il remplace la lecture exhaustive du code par un résumé structuré et précis.

---

## 1. Vue d'ensemble

**Package** : `@nevven-crm/billing-engine`
**Rôle** : Moteur de calcul de facturation BTP conforme EN 16931 (norme européenne de facturation électronique).
**Dépendance unique** : `decimal.js` — toute arithmétique monétaire passe par `Decimal`, jamais par `number` natif.
**Cible** : Librairie pure partagée front & back (aucun framework, aucun I/O, aucun side-effect).

### Ce que fait le moteur

1. Prend un **arbre métier** (devis BTP hiérarchique : proposition → sections → ouvrages → produits)
2. L'aplatit en **lignes EN 16931** (1 ligne = 1 produit feuille)
3. Applique un **mode de facturation** (devis 100 %, avancement %, acompte %)
4. Calcule le **document EN 16931** complet (HT, TVA par taux, TTC, retenues BTP)
5. Projette les montants sur **chaque nœud** de l'arbre (breakdown)
6. Optionnellement : calcule **coûts & marges** (hors EN 16931)

### Ce que le moteur ne fait PAS

- Pas de persistance / base de données
- Pas de validation métier (champs requis, statuts, workflow)
- Pas de génération PDF / XML
- Pas de gestion utilisateur / authentification

---

## 2. Architecture — modules et fichiers

```
billing-engine/
├── config.ts              ← Configuration Decimal.js + helpers d'arrondi
├── index.ts               ← Barrel (ré-exports publics)
├── model/index.ts         ← TOUS les types TypeScript (entrée + sortie)
├── tree/index.ts          ← Helpers de navigation sur l'arbre (walk, find)
├── pipeline/
│   ├── flattenTree.ts     ← Arbre → lignes plates (FlatLine[])
│   ├── applyBilling.ts    ← Applique le mode de facturation aux lignes
│   ├── computeDocument.ts ← Lignes → document EN 16931 complet
│   └── prepaid.ts         ← Calcul du piochage d'acomptes (BT-112)
├── breakdown/
│   ├── computeBreakdown.ts ← Document → montants par nœud de l'arbre
│   └── computeSituationWithAvenants.ts ← (réservé, vide)
├── costs/
│   ├── computeCosts.ts    ← Coûts & marges par nœud (hors EN 16931)
│   └── margins.ts         ← Calcul marge brute / nette
├── display/
│   └── toDisplay.ts       ← Document → modèle d'affichage (strings formatées)
├── adapter/
│   └── treeToSerialized.ts ← Conversion arbre app (LegacyNode) → SerializedNode
├── invariants/
│   └── invariants.ts      ← Garde-fou BR-CO-* (validation post-calcul)
└── __tests__/             ← Tests Jest (.spec.ts) + fixtures golden
```

---

## 3. Pipeline de calcul — flux de données détaillé

```
SerializedNode (arbre métier)
       │
       ▼
  flattenTree(tree, opts?)
       │  Parcours récursif pré-ordre. Pour chaque produit feuille :
       │    BT-129 (qty) = qty_produit × Π(qty_ancêtres)
       │    BT-146 (prix) = sellPrice × (1+majGlobale) × Π(1−remise_ancêtre) × (1−remise_produit)
       │  La remise globale (BG-20) NE descend PAS dans BT-146 (reste au document).
       │  Résultat : FlatLine[] — lignes EN 16931 non arrondies.
       ▼
  applyBilling(lines, { mode, percentByNodeKey })
       │  mode 'full' → identité (devis)
       │  mode 'advancement' → qty × (% / 100) par nœud
       │  mode 'deposit' → idem
       ▼
  computeDocument(lines, params?)
       │  Étape 1  : BT-131 = money(BT-129 × BT-146) — SEUL arrondi sur les lignes
       │  Étape 2  : BT-106 = Σ BT-131
       │  Étape 3  : Groupement par (vatCategory, vatRate)
       │  Étape 4  : Remise globale → 1 AllowanceCharge (BG-20) par groupe TVA
       │  Étape 5-6: BT-107 = Σ remises, BT-108 = 0 (pas de charges document)
       │  Étape 7  : BT-116 = base − remise, BT-117 = money(BT-116 × taux / 100)
       │  Étape 8  : BT-109 = money(BT-106 − BT-107 + BT-108)
       │  Étape 9  : BT-110 = Σ BT-117
       │  Étape 10 : BT-111 = money(BT-109 + BT-110)
       │  Étape 11 : BT-112 (prepaid), BT-113 (rounding)
       │  Étape 12 : BT-115 = money(BT-111 − BT-112 + BT-113)
       │  Étape 13 : Retenues BTP (prorata HT, garantie TTC, net à encaisser)
       │  Résultat : EN16931Document
       ▼
  computeBreakdown(tree, situationDoc, referenceDoc, percentByKey)
       │  Projette les montants du document sur chaque nœud de l'arbre :
       │    - feuille produit : montants de sa ligne
       │    - nœud parent : SOMME des enfants
       │    - proposition (racine) : écrasée par les totaux document
       │    - % dérivé parent : HT_situation / HT_devis × 100
       ▼
  TreeBreakdown = Record<nodeKey, NodeMonetary>
```

### Pipeline alternatif : situations (avancement BTP)

```
computeSituation(tree, cumPercent, prevPercent, params)
  │  Calcule la PÉRIODE = delta entre deux cumuls :
  │    période = breakdown(devis × %_cumulé) − breakdown(devis × %_précédent)
  │  Garantie : Σ périodes = marché AU CENTIME (télescopage des cumuls).
  │  Couvre : avancement, échéancier, avoirs (note de crédit = situation négative).
  ▼
TreeBreakdown (montants de la PÉRIODE uniquement)
```

---

## 4. Types clés (model/index.ts)

### Entrée

| Type | Rôle |
|------|------|
| `SerializedNode` | Nœud de l'arbre métier : `{ key, value: NodeValue, children[] }` |
| `NodeValue` | Données du nœud : `nodeType`, `sellPrice`, `vatRate`, `quantity`, `discountPercentage`, etc. |
| `NodeType` | `'proposition' \| 'section' \| 'ouvrage' \| 'product' \| 'commentary' \| 'option' \| 'variant'` |
| `BillingInput` | Mode de facturation : `{ mode: 'full'\|'advancement'\|'deposit', percentByNodeKey? }` |
| `DocumentParams` | Paramètres du document : remise globale, prorata, garantie, prepaid, avenants… |
| `DepositInvoice` | Acompte piochable : montant TTC, ventilation TVA, déjà pioché |

### Sortie

| Type | Rôle |
|------|------|
| `FlatLine` | Ligne plate (avant calcul) : lineId, qty, unitPrice, vatRate |
| `ComputedLine` | Ligne calculée : FlatLine + `netAmount` (BT-131) |
| `EN16931Document` | Document complet : lines, allowances, charges, vatBreakdown, summation, retainage |
| `MonetarySummation` | Totaux BT-106 à BT-115 |
| `VatGroup` | Ventilation TVA par (catégorie, taux) : BT-116, BT-117 |
| `RetainageSummary` | Retenues BTP : prorata, garantie, caution bancaire, net à encaisser |
| `NodeMonetary` | Montants projetés sur un nœud : HT, TTC, TVA par taux, % avancement |
| `TreeBreakdown` | `Record<nodeKey, NodeMonetary>` — montants de tous les nœuds |
| `DisplayModel` | Modèle d'affichage (strings formatées pour PDF/UI) |

### Coûts (hors EN 16931)

| Type | Rôle |
|------|------|
| `NodeCostInput` | Entrée coût d'un produit : materialPrice, costPrice, laborCost, workTime, hourlyRate |
| `NodeCost` | Coût calculé (proratisé par % avancement) |
| `NodeMargins` | Marges brute/nette + pourcentages |
| `TreeCostMargins` | `Record<nodeKey, { cost, margins }>` |

---

## 5. Règles d'arrondi (CRITIQUE)

```typescript
// config.ts
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP })
```

**Règle d'or** : précision interne maximale, AUCUN arrondi intermédiaire. On arrondit UNE SEULE FOIS les valeurs exposées.

| Fonction | Décimales | Usage |
|----------|-----------|-------|
| `money(d)` | 2 | Tout montant exposé (BT-131, totaux, TVA) |
| `unitPrice4(d)` | 4 | Prix unitaire affiché (BT-146 display) |

**Points d'arrondi dans le pipeline** :
1. `computeDocument` : `netAmount = money(qty × unitPrice)` — c'est LE seul arrondi sur les lignes
2. `computeDocument` : chaque total (BT-106 à BT-115) est arrondi via `money()`
3. `toDisplay` : prix unitaire à 4 décimales, montants à 2

**⚠️ Ne JAMAIS** :
- Arrondir un intermédiaire (ratio, facteur de prix, quantité non finale)
- Utiliser `number` natif pour de l'arithmétique monétaire
- Arrondir BT-146 (prix unitaire exact) dans le pipeline — seul l'affichage arrondit à 4

---

## 6. Règles BTP spécifiques

### Retenues (hors sommation EN 16931)

Les retenues ne modifient PAS BT-106 à BT-115 (la sommation EN 16931 reste standard).
Elles sont calculées APRÈS et stockées dans `RetainageSummary`.

| Retenue | Base | Formule |
|---------|------|---------|
| Compte prorata | HT (BT-109) | `prorataAmount = money(BT-109 × %prorata / 100)` |
| Retenue de garantie | TTC (BT-111) | `garantieAmount = money(BT-111 × %garantie / 100)` |
| Caution bancaire | — | Si `bankGuaranty=true` : garantieAmount=0, montant affiché seulement |
| Net à encaisser | — | `netToCollect = BT-115 − prorata − garantie` |

### Situations (avancement)

- Mécanisme **cumul-delta** : `période = cumul_actuel − cumul_précédent`
- Garantie : Σ périodes = marché AU CENTIME (pas de dérive d'arrondi)
- Un avoir = situation NÉGATIVE (`cum_before > cum_after`)
- **Chaînage obligatoire** : le `cum_before` d'un avoir = le `cum_after` de l'avoir précédent

### Acomptes (BT-112)

- Pas encore implémenté

---

## 7. API publique (exports de index.ts)

```typescript
// Pipeline principal
flattenTree(tree: SerializedNode, opts?: FlattenOptions): FlatLine[]
applyBilling(lines: FlatLine[], input: BillingInput): FlatLine[]
computeDocument(lines: FlatLine[], params?: DocumentParams): EN16931Document

// Breakdown (montants par nœud)
computeBreakdown(tree, situationDoc, referenceDoc, percentByKey, preserveKey?): TreeBreakdown
computeSituation(tree, cumPercent, prevPercent, params?, preserveKey?): TreeBreakdown
computeNodeMonetary(tree, doc, rateMap?): TreeBreakdown
buildRateToVatRateId(tree: Node): Record<string, string>

// Affichage
toDisplay(doc: EN16931Document, opts?: DisplayOptions): DisplayModel

// Validation
checkInvariants(doc: EN16931Document): Violation[]

// Adaptateur
treeToSerialized(tree: LegacyNode): SerializedNode

// Coûts & marges
computeCosts(tree, breakdown, percentByKey): TreeCostMargins
computeMargins(sellPrice, materialPrice, costPrice): NodeMargins

// Config
money(d: Numeric): Decimal      // arrondi 2 déc.
unitPrice4(d: Numeric): Decimal  // arrondi 4 déc.
ZERO, HUNDRED, Decimal           // constantes et re-export
```

---

## 8. Arbre métier — structure et navigation

L'arbre est un arbre N-aire : `{ key: string, value: NodeValue, children: Node[] }`.

### Hiérarchie typique

```
proposition (racine)
├── section (regroupement)
│   ├── ouvrage (sous-regroupement optionnel)
│   │   └── product (feuille — porte un prix)
│   └── product
├── section
│   └── product
└── commentary (ignoré dans les calculs)
```

### Helpers (tree/index.ts)

| Fonction | Usage |
|----------|-------|
| `walk(node, visit)` | Parcours pré-ordre |
| `walkPostOrder(node, visit)` | Parcours post-ordre (agrégations) |
| `findByKey(node, key)` | Recherche DFS par clé |
| `findParent(root, key)` | Parent dérivé (pas de back-pointer) |
| `isProduct(n)` / `isSection(n)` / `isProposition(n)` / etc. | Prédicats de type |
| `isMonetary(n)` | Tout sauf commentary |
| `isSelected(n)` | `false` si variante/option non sélectionnée |

---

## 9. Invariants EN 16931 vérifiés

Le module `invariants/invariants.ts` vérifie ces règles de cohérence :

| Règle | Formule |
|-------|---------|
| BR-CO-10 | BT-106 = Σ BT-131 (somme des montants nets de ligne) |
| BR-CO-11 | BT-107 = Σ BT-92 (somme des remises document) |
| BR-CO-12 | BT-108 = Σ BT-99 (somme des charges document) |
| BR-CO-13 | BT-109 = BT-106 − BT-107 + BT-108 |
| BR-CO-14 | BT-110 = Σ BT-117 (somme des montants TVA) |
| BR-CO-15 | BT-111 = BT-109 + BT-110 |
| BR-CO-16 | BT-115 = BT-111 − BT-112 + BT-113 |
| BR-CO-17 | BT-117 = money(BT-116 × BT-119 / 100) par groupe TVA |

---

## 10. Adaptateur (adapter/)

Convertit l'arbre de l'application (forme `LegacyNode` avec `Product.sellPrice`, `VatRate.ratePercentage`, `Unit.code`) vers le format canonique `SerializedNode` du moteur.

Mappings :
- `Product.sellPrice` → `sellPrice`
- `VatRate.ratePercentage` → `vatRate`
- `VatRate.category` → `vatCategory` (défaut `'S'`)
- `Unit.code` → `unitCode` (défaut `'C62'`)
- `VatRate.id` / `VatRate._id` → `vatRateId`
- Si la racine est `nodeType: 'root'`, descend sur le premier enfant (proposition)

---

## 11. Tests

**Framework** : Jest + ts-jest
**Lancer** : `npm test`

| Fichier | Couverture |
|---------|-----------|
| `golden.spec.ts` | Pipeline complet sur l'arbre de référence (doc/analyse.md §4) |
| `flatten.spec.ts` | `flattenTree` : BT-129, BT-146, remise globale exclue |
| `btp.spec.ts` | Avancement, acomptes, prorata, garantie, caution bancaire |
| `breakdown.spec.ts` | `computeBreakdown`, `computeSituation`, `computeCosts` |
| `creditNoteChaining.spec.ts` | Chaînage des notes de crédit (avoirs), régression |
| `adapter.spec.ts` | `treeToSerialized` : LegacyNode → SerializedNode |
| `display.spec.ts` | `toDisplay` : arrondis d'affichage |
| `invariants.spec.ts` | `checkInvariants` : validation BR-CO-* |

### Fixture de référence (`fixtures.ts`)

Arbre golden (doc/analyse.md §4) :
- Proposition : majoration globale 10 %, remise globale 5 %
- Section A (qté 2, remise 10 %) : A1 100€×3 TVA20, A2 50€×2 TVA20
- Section B (qté 1, remise 0 %) : B1 200€×1 TVA10, B2 80€×5 TVA20

Résultat attendu : BT-109 = 1 379,40 € / BT-111 = 1 634,38 €

---

## 12. Conventions et pièges

### À faire

- Toujours utiliser `Decimal` (via `config.ts`) pour l'arithmétique monétaire
- Arrondir UNIQUEMENT via `money()` ou `unitPrice4()`, jamais manuellement
- Tester avec `checkInvariants()` après chaque modification du pipeline
- Respecter le pattern immutable : les fonctions renvoient de nouveaux objets, pas de mutation

### Pièges courants

1. **Arrondi prématuré** : ne pas arrondir `netUnitPrice` (BT-146) — c'est un prix exact dans le pipeline
2. **Remise globale** : elle NE descend PAS dans BT-146, elle reste au document (BG-20)
3. **Retenues BTP** : elles ne modifient PAS la sommation EN 16931 (BT-106 à BT-115)
4. **Chaînage des avoirs** : le `cum_before` de chaque avoir doit être le `cum_after` du précédent, sinon dérive
5. **vatRateId** : identifiant opaque de l'app, PAS le taux — le moteur le porte tel quel pour keyer la sortie

### Scripts

```bash
npm run build       # Compile TypeScript
npm run test        # Tests Jest
npm run lint        # ESLint --fix
npm run format      # Prettier
```

---

## 13. Intégration avec le back-end

```typescript
// Côté back-end (crm-back-end)
import { computeDocument, flattenTree, treeToSerialized } from '@nevven-crm/billing-engine'

// 1. Convertir l'arbre app vers le format moteur
const tree = treeToSerialized(legacyTree)

// 2. Pipeline
const lines = flattenTree(tree)
const doc = computeDocument(lines, params)
```

Le package est déclaré comme dépendance GitHub :
```json
"@nevven-crm/billing-engine": "github:Esteban-caddev/billing-engine"
```

---

## 14. Glossaire EN 16931

| Code | Signification |
|------|--------------|
| BT-106 | Somme des montants nets de ligne |
| BT-107 | Somme des remises document |
| BT-108 | Somme des charges document |
| BT-109 | Total HT |
| BT-110 | Total TVA |
| BT-111 | Total TTC |
| BT-112 | Montant déjà payé (acomptes) |
| BT-113 | Arrondi |
| BT-115 | Montant dû |
| BT-116 | Base imposable par groupe TVA |
| BT-117 | Montant TVA par groupe |
| BT-119 | Taux TVA du groupe |
| BT-126 | Identifiant de ligne |
| BT-129 | Quantité facturée |
| BT-130 | Unité de mesure (UNECE) |
| BT-131 | Montant net de ligne |
| BT-146 | Prix net unitaire |
| BT-151 | Catégorie TVA de la ligne |
| BT-152 | Taux TVA de la ligne |
| BG-20 | Remise au niveau document |
| BG-22 | Totaux du document |
| BG-23 | Ventilation TVA |
| BG-25 | Ligne de facture |
| BR-CO-* | Règles de cohérence (Business Rule — Cross Object) |
