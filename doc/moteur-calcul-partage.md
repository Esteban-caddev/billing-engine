# Arrondis d'affichage & moteur de calcul partagé front/back

> Réponses aux deux dernières questions, à conserver comme trace de décision. S'appuie sur `doc/analyse.md` (bridge arbre → lignes) et `doc/facturation-btp.md` (règles BTP).

---

## PARTIE 1 — « Pas d'arrondi intermédiaire » vs lignes affichées dans le PDF

### 1.1 Le malentendu à lever

« Pas d'arrondi intermédiaire » **ne veut pas dire** « afficher des lignes non arrondies ».
Ça veut dire : ne pas arrondir **la chaîne de calcul** d'une valeur (`prix × quantité × facteurs de remise`) **avant** de produire le montant exposé, et ne pas arrondir les sous-totaux de section. Mais **chaque valeur affichée est bel et bien arrondie, une fois.**

La règle qui résout tout :

> **On arrondit une seule fois, au moment d'exposer une valeur. Les totaux sont la SOMME des valeurs déjà arrondies et affichées — jamais des valeurs internes.**

C'est exactement la règle EN 16931 **BR-CO-10** : `BT-106 = Σ BT-131`, où chaque `BT-131` (montant net de ligne) est **le montant arrondi affiché**.

### 1.2 Conséquence : l'addition à la main du client tombe toujours juste

Le client n'additionne **pas** des `quantité × prix unitaire` : il additionne **la colonne des montants de ligne** (déjà arrondis). Comme le sous-total HT est défini comme la somme de ces mêmes montants arrondis, la colonne se vérifie au centime.

```
Ligne 1  ...........  33,33 €
Ligne 2  ...........  35,18 €
Ligne 3  ...........  12,49 €
                     --------
Sous-total HT        81,00 €   ← = 33,33 + 35,18 + 12,49, à la main
```

Aucune incompréhension : ce qui est affiché EST ce qui est additionné.

### 1.3 Le vrai cas délicat : `quantité × prix unitaire ≠ montant affiché`

Avec des quantités à virgule, le client peut tenter `quantité × prix unitaire` et tomber à côté :

```
quantité 3,333  ×  prix unitaire affiché 10,56 €  = 35,20 €
mais montant de ligne réel = round(3,333 × 10,5546…) = 35,18 €
```

L'écart vient du fait que le **prix unitaire affiché est lui-même arrondi**. Trois solutions normées, par ordre de préférence :

1. **Afficher le prix unitaire avec plus de décimales.** EN 16931 autorise le prix net article (`BT-146`) avec une précision supérieure aux 2 décimales des montants. Afficher `10,5546` rend `3,333 × 10,5546 = 35,18` reproductible.
2. **Quantité de base (`BT-149`/`BT-150`)** : exprimer « prix pour 100 unités » quand le prix unitaire ne tombe pas juste (`BT-146 = 1 055,46 € pour 100`).
3. **Le montant de ligne fait foi** : convention explicite (mention bas de page) que le prix unitaire est indicatif et que `BT-131` est la valeur de référence. C'est ce que font la plupart des ERP.

> Recommandation : (1) par défaut (4 décimales sur le prix unitaire affiché), (3) en filet de sécurité via une mention. Ne jamais recalculer le total du PDF à partir des prix unitaires affichés — toujours sommer les montants de ligne.

### 1.4 Les règles d'arrondi, en pratique

| Règle | Énoncé |
|---|---|
| R1 | Calcul interne en `Decimal` (precision 40), **aucun arrondi** sur `prix × qté × (1−remise)…` ni sur les sous-totaux de section/ouvrage |
| R2 | Chaque **valeur exposée** est arrondie **une fois**, `HALF_UP`. Montants : 2 décimales. Prix unitaire affiché : 4 décimales |
| R3 | `BT-106 = Σ BT-131` (sommer les **montants de ligne arrondis**, pas les internes) → la colonne s'additionne à la main |
| R4 | **TVA par groupe** : `round(base × taux, 2)` **une seule fois** par couple (catégorie, taux). Base = Σ lignes nettes arrondies − remises. Jamais ligne par ligne puis somme |
| R5 | Remises/charges document : arrondies une fois ; `BT-116 = base − remise` reste cohérent |

Avec ces règles, les **rustines actuelles** (VAT remainder, « dernier paiement = reste », largest-remainder DPGF, `adjustToRestIfClose`) deviennent **inutiles** : tout foote par construction.

---

## PARTIE 2 — Un moteur de calcul partagé front ↔ back

### 2.1 Pourquoi

Aujourd'hui la même logique est dupliquée et **diverge** (cf. `analyse.md` §3.3 et `facturation-btp.md` §5) :
- bottom-up `calculate*` (back) vs top-down `getEffectiveDiscountedPrice` (back/DPGF) ;
- `TreeNode` (front+back) vs `tree-percentage.helper` (back) vs `TreePercentageProvider` (front) ;
- signe du prorata incohérent, `bankGuaranty` traité d'un côté seulement, V1/V2.

Un **moteur unique, pur, partagé** supprime la question « est-ce que le front et le back calculent pareil ? » par construction.

### 2.2 Forme : un package partagé sans dépendance framework

```
@crm/billing-engine
  - TypeScript pur, seule dépendance runtime : decimal.js
  - AUCUNE dépendance NestJS / Mongoose / React / DOM
  - 100 % déterministe : aucune Date.now(), aucun accès réseau/IO
  - entrées/sorties sérialisables (DTO plats)
```

Comme `crm-back-end` et `crm-client-admin` sont deux dépôts séparés, deux options :

| Option | Pour | Contre |
|---|---|---|
| **npm package privé versionné** (semver) | découplage propre, versionnable | publication/CI à mettre en place |
| git submodule / subtree | simple à démarrer | versionnage manuel, DX moins bonne |

→ Recommandation : **package npm privé**, versionné, avec golden tests embarqués.

### 2.3 API (fonctions pures)

```ts
// 1) Aplatissement arbre métier -> lignes (cf. analyse.md §4.3)
flattenTree(tree: SerializedTree, opts: FlattenOptions): FlatLine[]

// 2) Couche facturation : applique le % d'avancement / acomptes / déjà facturé
applyBilling(lines: FlatLine[], billing: BillingInput): FlatLine[]

// 3) Calcul EN 16931 + règles BTP (RG, prorata, acompte pioché)
computeDocument(
  lines: FlatLine[],
  params: DocumentParams        // remise/maj globale, paymentCondition, prepaid, refs
): EN16931Document

// 4) Modèle d'affichage (PDF / écran) — applique les règles d'arrondi de la Partie 1
toDisplay(doc: EN16931Document, opts: DisplayOptions): DisplayModel
```

```ts
type EN16931Document = {
  lines: ComputedLine[]            // BT-129/146/131, catégorie+taux TVA
  documentAllowances: AllowanceCharge[]  // remise globale, prorata, RG
  documentCharges: AllowanceCharge[]     // majoration globale (option)
  vatBreakdown: VatGroup[]               // BT-116/117 par (catégorie, taux)
  summation: {                           // BT-106..BT-115
    lineNetTotal; allowanceTotal; chargeTotal; taxExclusive;
    taxTotal; taxInclusive; prepaid; rounding; payable
  }
  precedingInvoiceRefs: DocRef[]          // BG-3 (acomptes, situations N-1)
  calculationVersion: string              // gravé dans la facture stockée
}
```

### 2.4 Le devis et la facturation, un seul chemin

- **Devis** = `applyBilling(lines, { mode: 'full' })` (100 %, pas de prepaid) → `computeDocument`.
- **Situation d'avancement** = `applyBilling(lines, { mode: 'advancement', percentages, alreadyInvoiced })`.
- **Acompte / échéancier** = `applyBilling(lines, { mode: 'deposit', percentages })`.
- **Solde** = `mode: 'advancement'` avec `percentages` = reste.
- **Avoir** = situation négative référencée.

Le « rest », le « VAT remainder » et le « dernier = reste exact » deviennent un simple `prepaid = Σ déjà facturé` (`BT-112`) calculé en amont — plus aucune logique d'arrondi de rattrapage.

### 2.5 Règles BTP centralisées (source unique)

- **Retenue de garantie** : `allowance` document conditionnée par `bankGuaranty` (si caution → pas de retenue) — **un seul** endroit, fini l'incohérence `facturation-btp.md` §5.2.
- **Compte prorata** : `allowance` document, base HT, **signe arrêté une fois pour toutes** (résout §5.1).
- **Acompte pioché** : `prepaid` (`BT-112`) + `precedingInvoiceRefs`.

### 2.6 Versionnage des calculs (légal/comptable)

Une facture émise doit **toujours se recalculer à l'identique**. Le moteur expose une `calculationVersion` ; chaque facture stocke la version utilisée. Une évolution de règle = nouvelle version, les anciennes factures restent reproductibles. (Remplace proprement l'actuel `calculationVersion '1.0.0'/'2.0.0'`.)

### 2.7 Garanties de non-régression

- **Golden tests** partagés (dont l'exemple de `analyse.md` §4 : 1 379,40 HT / 1 634,38 TTC) exécutés dans la CI des **deux** dépôts.
- Propriétés vérifiées : `Σ BT-131 == BT-106`, `BT-111 == BT-109 + BT-110`, `Σ situations == marché`, `Σ TVA situations == TVA marché`.
- Pureté : aucun `Date`, `Math.random`, accès Mongo/DOM dans le package (lintable).

### 2.8 Migration suggérée

1. Extraire le bridge (`flattenTree`) + `computeDocument` en package, avec golden tests sur cas réels existants.
2. Back : remplacer `processTreePropositionV2` / `tree-percentage.helper` / stratégies par des appels au moteur.
3. Front : remplacer `TreePercentageProvider` (calculs) + `TreeNode.calculate*` par le moteur ; le front ne garde que l'UI et la saisie des %.
4. Supprimer `getEffectiveDiscountedPrice`, le hack largest-remainder DPGF, les rattrapages d'arrondi.
5. Retirer V1 / le branchement `calculationVersion === '2.0.0'`.

---

## Décisions à acter (récap inter-docs)

1. Signe du **prorata** (retenue → soustrait). *(facturation-btp §5.1)*
2. **RG** en Factur-X : allowance document vs conditions de paiement. *(à valider PPF)*
3. **Majoration globale** : prix article vs charge document. *(analyse §)*
4. **Avenant** : arbre de référence versionné. *(facturation-btp §2.6)*
5. **Profil** Factur-X cible : EN 16931 vs EXTENDED.
6. **Packaging** du moteur : npm privé vs submodule.
7. Précision d'affichage du **prix unitaire** : 4 décimales + mention « le montant de ligne fait foi ».
