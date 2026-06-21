# Analyse — Arbre métier & `processTreePropositionV2` face à EN 16931

> Hypothèse de cette analyse : le pipeline de calcul de `processNodeV2.ts` est **actif** (les appels `calculateUnitPrice/Quantity/Discount/VatRate/TotalTTC/Prorata/Garantie/NetToPay` sont décommentés). On évalue donc le moteur V2 « complet », pas la version dégradée coût/marge.
>
> Référence des champs et règles EN 16931 : voir `doc/arbre metier vers lignes EN 16931.md`.

---

## 1. Cartographie du moteur

| Composant | Fichier | Rôle |
|---|---|---|
| Types de nœuds | `src/common/tools/Tree/TreeNodeValue.ts` | `proposition / section / ouvrage / product / commentary / option / variant` |
| Nœud + moteur | `src/common/tools/Tree/TreeNode.ts` | Méthodes `calculate*` qui **mutent `node.value`** |
| Pipeline V2 | `src/common/tools/Tree/processNodeV2.ts` → `processTreePropositionV2()` | Recalcul **bottom-up** complet |
| Pipeline V1 | `src/common/tools/Tree/processNode.ts` | Ancien moteur, encore actif selon `calculationVersion` |
| Totaux situations/avancement | `src/modules/invoicing/invoice/helpers/tree-percentage.helper.ts` | TVA, prorata, garantie, reste-à-facturer |
| Aplatissement vers lignes (DPGF) | `src/resources/dpgf/dpgf.service.ts` | `getEffectiveDiscountedPrice()` + correction d'arrondi |

Le choix de moteur se fait à l'exécution (`invoice.service.ts:758`) :

```ts
if (calculationVersion === '2.0.0') processTreePropositionV2(...)
else { processNodeProposition(...); aggregateV1Margins(...) }
```

→ **Deux moteurs coexistent** (V1 et V2). Première dette : tant que `calculationVersion` peut valoir autre chose que `2.0.0`, il faut maintenir les deux.

---

## 2. Ce que fait `processTreePropositionV2` (pipeline actif)

Parcours **bottom-up** : on calcule d'abord les feuilles (produits), puis on agrège en remontant.

```
computeProduct(produit, majGlobale):
    calculateUnitPrice(majGlobale)   // prix unitaire majoré
    calculateQuantity()              // × quantité produit
    calculateDiscount()              // × (1 − remise produit)
    calculateCost(); calculateMargins()

computeSection(section, majGlobale):
    pour chaque enfant -> computeProduct / computeSection (récursif)
    calculateUnitPrice(majGlobale)   // = Σ enfants.discountedPrice
    calculateQuantity()              // × quantité section
    calculateDiscount()              // × (1 − remise section)
    calculateCost(); calculateMargins()

processTreePropositionV2(proposition, vatRatesById):
    pour chaque section -> computeSection(section, majGlobale)
    calculateUnitPrice(0)            // = Σ sections.discountedPrice
    calculateQuantity()              // totalPrice = unitPrice
    calculateDiscount()              // × (1 − remise globale)
    calculateVatRate(vatRatesById)   // TVA par vatRateId
    calculateTotalTTC()
    calculateProrata(); calculateGarantie(); calculateNetToPay()
    calculateCost(); calculateMargins()
```

### Ordre métier effectif

```
sellPrice
  × (1 + majoration globale)        ← appliquée AU PRODUIT (TreeNode.ts:242)
  × quantité produit
  × (1 − remise produit)
  × quantité section                ← peut se composer sur N niveaux
  × (1 − remise section)
  → remise globale (proposition)    ← niveau document (TreeNode.ts:306)
  → TVA par taux                    ← groupée par vatRateId (TreeNode.ts:341)
```

C'est cohérent avec l'esprit EN 16931 sur deux points clés :
- ✅ **remise globale au niveau document** (pas répartie arbitrairement) ;
- ✅ **TVA groupée par taux** sur la base HT remisée, et non ligne-par-ligne sommée.

---

## 3. Problèmes identifiés (pipeline actif)

### 3.1 — Le calcul vit sur l'arbre, pas sur un modèle plat *(structurel)*
Les montants sont écrits dans `node.value`. EN 16931 raisonne en facture **plate** (lignes + totaux). Tant que le calcul reste porté par l'arbre, produire un Factur-X conforme oblige à re-parcourir l'arbre et à re-dériver les lignes — c'est là que naissent les écarts (cf. 3.3). Difficile aussi à tester unitairement.

### 3.2 — Arrondi intermédiaire systématique *(correction / centimes)*
Chaque `calculate*` fait `lodash.round(x, 2)` à **chaque nœud et chaque multiplication** (`TreeNode.ts:242, 267, 287, 306, 325, 343…`). La cible (§5 du doc de référence) impose l'inverse : précision maximale en interne (Decimal.js, precision 40), arrondi `HALF_UP` 2 décimales **uniquement** sur les montants exposés. Sur un arbre profond, l'arrondi à chaque niveau accumule des dérives.

### 3.3 — Deux chemins de calcul divergents — **déjà patché en production**
Deux implémentations des mêmes remises coexistent :
- **bottom-up** : `calculate*` (somme remontante, arrondie à chaque niveau) ;
- **top-down** : `getEffectiveDiscountedPrice()` (`TreeNode.ts:549`) qui repart de la feuille et applique `quantité × (1 − remise)` de chaque ancêtre puis la remise globale.

Elles n'arrondissent pas dans le même ordre → résultats différents au centime. **La preuve est déjà dans le code** : `dpgf.service.ts:432-468` calcule l'écart entre `Σ getEffectiveDiscountedPrice(true)` (lignes) et `propositionNode.displayDiscountedPrice()` (total arbre), puis applique une **correction « largest-remainder »** sur la ligne au plus gros reste :

```ts
const discrepancy = round(propositionTotal - sumRounded, 2)
// ... on pousse l'écart sur la ligne au plus gros remainder
adjustments.set(maxEntry.nodeKey, discrepancy)
```

C'est exactement le risque **BR-CO-10** (`BT-106 = Σ BT-131`) traité par un patch *a posteriori*. Avec un vrai modèle plat sans arrondi intermédiaire, cet écart n'existe pas et le hack disparaît.

### 3.4 — Pas de code catégorie TVA (BT-151) *(conformité)*
`calculateVatRate` groupe par `vatRateId` interne et n'expose qu'un taux. EN 16931 exige le couple **(catégorie BT-151 ∈ {S,Z,E,AE,…}, taux BT-152)**. Il manque la catégorie côté `VatRate`.

### 3.5 — Garantie / prorata hors norme *(modélisation)*
`calculateGarantie` / `calculateProrata` (retenue de garantie, compte prorata BTP) impactent `netToPay` mais n'ont **aucun champ dans la sommation monétaire EN 16931** (BT-106…BT-115). À positionner explicitement : remise/charge document, ou mention de paiement hors-bande.

### 3.6 — Variant/option : prix et coût filtrés différemment *(probable bug — à vérifier)*
- `calculateCost` **exclut** les enfants non sélectionnés d'un conteneur variant/option : `if (!child.value.variantOptionIsSelected && this.isVarianteOrOptionNode()) return` (`TreeNode.ts:457`).
- `calculateUnitPrice` (branche section) **ne filtre pas** : il somme `discountedPrice` de **tous** les enfants monétaires (`TreeNode.ts:263-272`).
- Dans `computeSection`, le garde `if (!child.value.variantOptionIsSelected && node.isVarianteOrOptionNode()) return` est placé **en fin de callback** (`processNodeV2.ts:62`) : il ne saute rien (code mort), les enfants non sélectionnés sont quand même calculés.

→ Sur un nœud variant/option, le **prix** semble inclure les options non sélectionnées alors que le **coût** les exclut : prix et marge incohérents. À confirmer avec un cas réel.

### 3.7 — Sémantique trompeuse de `unitPrice` de section *(lisibilité)*
Pour une section, `unitPrice` n'est pas un prix unitaire mais `Σ discountedPrice` des enfants (déjà remisés), que `calculateQuantity` re-multiplie par la quantité de section. Les remises se composent donc (produit × section × globale). À documenter / confirmer comme intention.

---

## 4. Arbre d'exemple et transformation en lignes

### 4.1 Structure
Proposition : `globalMajorationPercentage = 10 %`, `globalDiscountPercentage = 5 %`.

```
Proposition (maj. globale 10 %, remise globale 5 %)
├── Section A   (quantity = 2, discountPercentage = 10 %)
│   ├── Produit A1  sellPrice 100,00 €  qty 3   TVA 20 %
│   └── Produit A2  sellPrice  50,00 €  qty 2   TVA 20 %
└── Section B   (quantity = 1, discountPercentage = 0 %)
    ├── Produit B1  sellPrice 200,00 €  qty 1   TVA 10 %
    └── Produit B2  sellPrice  80,00 €  qty 5   TVA 20 %
```

### 4.2 Calcul tel que produit par V2 (bottom-up)

| Produit | unitPrice (×1,10) | qty | totalPrice | discountedPrice |
|---|--:|--:|--:|--:|
| A1 | 110,00 | 3 | 330,00 | 330,00 |
| A2 |  55,00 | 2 | 110,00 | 110,00 |
| B1 | 220,00 | 1 | 220,00 | 220,00 |
| B2 |  88,00 | 5 | 440,00 | 440,00 |

- **Section A** : unit V20 `440,00` → ×2 = `880,00` → ×0,90 = **`792,00`**
- **Section B** : V10 `220,00` · V20 `440,00`
- **Proposition** : V20 `1 232,00` → ×0,95 = `1 170,40` ; V10 `220,00` → ×0,95 = `209,00`

```
finalHT  = 1 379,40
TVA V20  = 234,08 · TVA V10 = 20,90 → 254,98
totalTTC = 1 634,38
```

### 4.3 Aplatissement EN 16931 (bridge cible)

```
BT-129 = product.quantity × Π(ancêtres.quantity)
BT-146 = sellPrice × (1 + majGlobale) × Π(1 − remiseAncêtre) × (1 − remiseProduit)
BT-131 = BT-129 × BT-146           (sans arrondi intermédiaire)
remise globale → niveau document (n'entre PAS dans BT-146)
```

| Ligne | BT-129 | BT-146 | BT-131 | TVA |
|---|--:|--:|--:|:--|
| A1 | 6 | 99,00  | 594,00 | S/20 |
| A2 | 4 | 49,50  | 198,00 | S/20 |
| B1 | 1 | 220,00 | 220,00 | S/10 |
| B2 | 5 | 88,00  | 440,00 | S/20 |

```
BT-106 = 1 452,00
Remise doc 5 % : V20 → 61,60 ; V10 → 11,00   → BT-107 = 72,60
BT-109 = 1 452,00 − 72,60 = 1 379,40                 ✅ = finalHT
V20 : BT-116 = 1 170,40 → BT-117 = 234,08
V10 : BT-116 =   209,00 → BT-117 =  20,90
BT-110 = 254,98 · BT-111 = 1 634,38                  ✅ = totalTTC
```

Le document plat se réconcilie **au centime** avec l'arbre — **à condition** de supprimer les arrondis intermédiaires (sinon : écart traité par le hack DPGF, cf. 3.3).

---

## 5. Mapping EN 16931 → arbre métier

### Niveau ligne (1 ligne = 1 produit feuille)

| EN 16931 | Source arbre |
|---|---|
| BT-126 Line id | `product.key` / `fullIndex` |
| BT-127 Line note | `observations` |
| BT-129 Quantity | `product.quantity × Π(ancêtres.quantity)` |
| BT-130 Unit (UNECE) | `product.Unit` → code UNECE (H87, MTR, KGM…) |
| BT-148 Item gross price | `Product.sellPrice` (+ majoration si « fondue ») |
| BT-147 Item price discount | remise produit/section si modélisées au prix article |
| BT-146 Item net price | `sellPrice × (1+majGlobale) × Π(1−remise)` |
| BT-131 Line net amount | `BT-129 × BT-146` |
| BT-153 Item name | `Product.name` / `node.name` |
| BT-151 VAT category | **à dériver** de `VatRate` (S/Z/E/AE) — champ manquant |
| BT-152 VAT rate | `VatRate.ratePercentage` (via `vatRateId`) |
| BG-27 Line allowances | remise produit/section si modélisées en remise de ligne |

### Niveau document

| EN 16931 | Source / calcul |
|---|---|
| BG-20 / BT-92/94/95 Remise doc | `globalDiscountPercentage` par groupe TVA |
| BG-21 / BT-99 Charge doc | `globalMajorationPercentage` *(si exposée en charge)* |
| BT-106 | `Σ BT-131` |
| BT-107 / BT-108 | `Σ remises` / `Σ charges` document |
| BT-109 Total HT | `BT-106 − BT-107 + BT-108` ↔ `finalHT` |
| BG-23 / BT-116 par groupe | `Σ BT-131(groupe) − remise(groupe) + charge(groupe)` |
| BT-117 par groupe | `round(BT-116 × taux/100, 2)` ↔ `vatRate[id]` |
| BT-110 / BT-111 | `Σ BT-117` / `BT-109 + BT-110` ↔ `totalTTC` |
| BT-112 / BT-115 | acomptes/situations (`tree-percentage.helper`) / reste à payer |
| *(hors norme)* Garantie | `paymentCondition.garantiePercentage` |
| *(hors norme)* Prorata | `paymentCondition.prorataPercentage` |

### Concepts arbre sans équivalent natif → stratégie de bridge

| Concept | Stratégie |
|---|---|
| Quantité de section/ouvrage | multiplier dans `BT-129` des lignes filles |
| Remise de section | fondre dans `BT-146` **ou** remise de ligne `BT-136` |
| Majoration globale | fondre dans `BT-146` **ou** charge document `BT-99` *(à trancher)* |
| Garantie / prorata | remise/charge document **ou** mentions de paiement *(à trancher)* |
| Arbre N niveaux | aplatir : 1 ligne par produit feuille |

---

## 6. Verdict & plan

**Fait-on bien les choses ?** Le **principe** est bon (remise globale + TVA au niveau document, groupement par taux), mais l'**implémentation** porte trois dettes qui empêchent une conformité EN 16931 / Factur-X fiable :

1. calcul sur l'arbre au lieu d'un modèle plat ;
2. arrondi à chaque étape → dérives déjà patchées à la main (DPGF) ;
3. deux chemins de calcul (bottom-up vs `getEffectiveDiscountedPrice`) qui divergent.

**Plan recommandé**
1. Modèle plat `EN16931Invoice` (types §6 du doc de référence) en `Decimal`.
2. **Un seul** bridge pur `InvoiceTree → EN16931Invoice` (aplatissement §4.3) ; supprimer le double chemin et le hack largest-remainder.
3. Sortir tout le calcul de montants de `TreeNode` ; l'arbre ne produit plus que des lignes.
4. Decimal.js precision 40, arrondi `HALF_UP` 2 décimales **uniquement** sur les montants exposés ; TVA par groupe sur base exacte.
5. Ajouter le **code catégorie TVA** (BT-151) à `VatRate` + mapping.
6. Trancher : majoration globale (prix article vs charge doc) et garantie/prorata (remise/charge doc vs hors-bande).
7. Corriger/écrire le filtrage variant-option (3.6) de façon cohérente prix ↔ coût.
8. Tests de réconciliation : `Σ BT-131 == BT-106`, `BT-109/110/111` arbre == document, golden test sur l'exemple §4.
9. Retirer V1 une fois V2/bridge généralisé (supprimer le branchement `calculationVersion`).
