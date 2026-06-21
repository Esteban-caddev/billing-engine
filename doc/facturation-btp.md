# Facturation réelle & règles de calcul BTP

> Suite de `doc/analyse.md` (qui couvre le devis / `processTreePropositionV2`). Ici on traite la **facturation** : acomptes, situations d'avancement, retenue de garantie, compte prorata, avoirs et avenants — puis leur projection vers EN 16931 / Factur-X.
>
> Fichiers clés :
> - Front : `crm-client-admin/src/providers/TreePercentageProvider.tsx`
> - Back stratégies : `src/modules/invoicing/invoice/factory/strategy/*.ts`
> - Back helpers : `src/modules/invoicing/invoice/helpers/tree-percentage.helper.ts`
> - Conditions de paiement : `src/resources/payment-condition/entities/payment-condition.entity.ts`
> - Avoirs : `src/resources/credit-invoice/`

---

## 1. Vocabulaire & modèle de données

Le **devis** (offer / proposition) porte l'arbre de référence et son `paymentCondition`. À partir de lui, on génère des **factures**. Le `paymentType` pilote la stratégie :

| `paymentType` | Stratégie | Sens métier |
|---|---|---|
| `net` | `DepositNetInvoiceStrategy` | facture unique, 100 % |
| `deposit` | `DepositNetInvoiceStrategy` | acompte(s) / échéancier (`nbPayment`, `paymentPercentages[]`) |
| `recurrent` | — | facturation récurrente |
| `advancement` | `AdvancementInvoiceStrategy` | **situations de travaux** (avancement saisi ligne par ligne) |

Champs BTP de `PaymentCondition` :

| Champ | Rôle |
|---|---|
| `isGarantie`, `garantiePercentage` | **retenue de garantie** (RG), en général 5 % |
| `garantieTimingMonths` | délai de libération de la RG (souvent 12 mois) |
| `garantieLabelOffer` / `garantieLabelInvoice` | libellés affichés |
| `bankGuaranty`, `bankGuarantyComment` | **caution bancaire** : remplace la RG → pas de retenue |
| `isProrata`, `prorataPercentage`, `prorataObservation` | **compte prorata** (dépenses communes de chantier) |
| `nbPayment`, `everyXDays`, `paymentPercentages[]` | échéancier |
| `isFirstPayment`, `firstPayment`, `daysAfterValidation` | dates d'échéance |
| `shouldCreateTrueDeposit` | **vrai acompte** (facture d'acompte avec TVA, déductible ensuite) |
| `shouldCreateFalseDeposit`, `falseDepositAmount`, `falseDepositHasGarantie` | **faux acompte** (appel de fonds sans TVA) |

---

## 2. Les flux de facturation

### 2.1 Acompte (vrai / faux) et acompte « piochable »

- **Vrai acompte** (`shouldCreateTrueDeposit`) : une facture d'acompte avec TVA est émise. Son montant est ensuite **déductible** des situations/factures suivantes — c'est l'acompte *piochable* : à chaque facture suivante on « pioche » une partie de l'acompte déjà encaissé pour réduire le **net à payer**, sans toucher au HT/TVA de la situation.
- **Faux acompte** (`shouldCreateFalseDeposit`) : simple appel de fonds, pas de TVA, régularisé plus tard.

> En EN 16931, l'acompte piochable = `BT-112` (montant déjà payé) qui vient **diminuer `BT-115`** (reste à payer), avec une **référence à la facture d'acompte** (`BG-3` / `BT-25` n°, `BT-26` date). Le HT (`BT-109`) et la TVA (`BT-110`) de la situation ne changent pas — seul le payable bouge.

### 2.2 Échéancier (`deposit` / `net`)

`DepositNetInvoiceStrategy` boucle sur `nbPayments` :
- chaque paiement = `paymentPercentages[index]` (ou `1/nbPayment`) du total ;
- garde-fou : si le cumul dépasse 100 %, on saute (`deposit-net…:72, 201`) ;
- **dernier paiement = reste exact** : on ne ré-applique pas un %, on calcule `référence − cumul` pour que la somme retombe au centime (`calculateLastInvoiceValues`, `createV2TreeWithRemainder`).

### 2.3 Situations d'avancement (`advancement`)

C'est le cœur BTP, piloté côté front par `TreePercentageProvider`.

- On part d'un `advancementTree` **à 0 %** (`createTreeV2PercentageZero`, `advancement…strategy:83`).
- L'utilisateur saisit un **% d'avancement par nœud** (`updatePercentage`) ou un **montant en €** (`updateEuro`), à n'importe quel niveau de l'arbre.
- **Référence vs déjà facturé** : `getAlreadyUsed(node)` somme les situations précédentes (`appliedTrees`) **et soustrait les avoirs** (`revertedTrees`, via `creditPercentage`). `getRest(node) = référence − déjàUtilisé` borne ce qu'on peut encore facturer (`percentageCanBeAssigned`, `valueCanBeAssigned`).
- **Propagation section → enfants** : régler une section à X % déclenche une **recherche par dichotomie** (`updatePercentage`, boucle 50 itérations, `TreePercentageProvider.tsx:517-548`) pour répartir le montant cible sur les enfants « libres » (les enfants déjà au max sont verrouillés). C'est de la **répartition d'un objectif € sur des lignes**, avec `setToMax` pour saturer.
- **Complétion à 100 %** : `snapToMaxIfFull` / `adjustToRestIfClose` (back, `tree-percentage.helper.ts:180`) : si `(courant + déjà) ≈ référence` à 0,01 % près, on force exactement la valeur « rest » pour éviter les traînes de centimes.
- **TVA cumulée** : `getVatRemainder` / `calculateVatForAdvancement` (`TreePercentageProvider.tsx:326-387`) recalculent la TVA en rattrapant l'écart entre la TVA exacte et la TVA déjà émise sur les situations précédentes — pour que la **somme des TVA des situations = TVA du marché**.

### 2.4 Solde

Dernière situation = `100 % − Σ situations`. Géré par le « reste exact » (`createV2TreeWithRemainder` + `calculateV2LastInvoiceTotals`), même logique que le dernier paiement d'échéancier.

### 2.5 Avoirs (`credit-invoice`)

Annulation totale ou partielle d'une situation : `revertedTrees` + `creditPercentage`. `getAlreadyUsed` les soustrait du « déjà facturé », ce qui **réouvre** le pourcentage facturable correspondant.

### 2.6 Avenants ⚠️ *(à concevoir)*

Un **avenant** modifie le marché (montant de référence) en cours de chantier. Aucun champ dédié n'a été trouvé dans le modèle (`paymentCondition`, `invoice`, `offer`). Aujourd'hui c'est probablement géré en **dupliquant/versionnant l'offre**, ce qui casse la continuité `référence ↔ appliedTrees` (les situations passées pointent sur l'ancienne référence).

→ **Décision nécessaire** : modéliser l'avenant comme un **nouvel arbre de référence versionné** (avec un montant initial + Δ avenant), et faire pointer `getRest` sur la référence **en vigueur à la date de la situation**. En EN 16931, l'avenant se traduit par une **référence de commande/marché** mise à jour (`BT-13` order ref, `BT-14` …) et éventuellement de nouvelles lignes.

---

## 3. Règles de calcul BTP

### 3.1 Ordre par situation

```
montant HT situation   = Σ (HT marché par nœud × % avancement du nœud)   ← borné par le rest
TVA situation          = par taux, avec rattrapage du remainder cumulé
TTC situation          = HT + TVA
compte prorata         = HT × prorataPercentage        (retenue)
retenue de garantie    = TTC × garantiePercentage      (sauf caution bancaire)
acompte pioché         = montant déduit (BT-112)
net à payer            = TTC − prorata − garantie − acompte pioché
```

### 3.2 Retenue de garantie

- Retenue sur **chaque** situation (`garantiePercentage`, base TTC).
- **Caution bancaire** (`bankGuaranty=true`) → **pas de retenue** : le client paie le TTC plein, la banque garantit. Implémenté dans `TreeNode.calculateNetToPay` (`TreeNode.ts:406-411`).
- Libération après `garantieTimingMonths` (souvent 12 mois) → facture/règlement de **libération de RG**.

### 3.3 Compte prorata

`prorataPercentage` appliqué au HT, **retenu** sur le net à payer. Sert à financer les dépenses communes du chantier.

### 3.4 Gestion des arrondis (cumul de situations)

Deux mécanismes pour que `Σ situations = marché` exactement :
1. **dernier = reste** (`createV2TreeWithRemainder`, `calculateLast*`) ;
2. **VAT remainder** (`getVatRemainder`) qui ré-injecte l'écart de TVA cumulé.

Ce sont des **rustines d'arrondi** — symptôme du même problème que dans `doc/analyse.md` §3.2/3.3 : on arrondit trop tôt. Sur un modèle plat en Decimal, ces deux mécanismes deviennent inutiles (le reste est exact par construction).

---

## 4. EN 16931 & Factur-X EXTENDED pour le BTP

### 4.1 Les profils Factur-X

`MINIMUM` → `BASIC WL` → `BASIC` → **`EN 16931` (COMFORT)** → **`EXTENDED`**.
`EN 16931` = profil de conformité réglementaire (la réforme française l'exige au minimum). `EXTENDED` est un **surensemble du CII** qui débloque des champs non autorisés en EN 16931.

### 4.2 Où vont les concepts BTP

| Concept BTP | Profil | Modélisation |
|---|---|---|
| Remise globale | EN 16931 | remise document `BG-20` par groupe TVA |
| Majoration globale | EN 16931 | charge document `BG-21` *(ou fondue dans le prix, cf. `analyse.md`)* |
| **Compte prorata** | EN 16931 | remise document `BG-20` (`BT-92` montant, `BT-97` motif, `BT-95/96` cat+taux) — base HT |
| **Retenue de garantie** | EN 16931 / conditions de paiement | en pratique : `AllowanceCharge` document **ou** mention dans les conditions de paiement (`BT-20`). ⚠️ pas de `BT` natif « retenue » → **à valider contre la spec PPF/AFNOR** |
| **Acompte piochable** | EN 16931 | `BT-112` (montant payé) + réf. facture d'acompte (`BG-3`/`BT-25`/`BT-26`) → diminue `BT-115` |
| **Situations** (lien entre elles) | EN 16931 / EXTENDED | référence facture précédente `BG-3` ; EXTENDED si plusieurs réfs / détail par ligne |
| **Avenant** | EN 16931 | référence de marché/commande (`BT-13`, `BT-14`) + nouvelles lignes |
| Libération de RG | EN 16931 | facture/ligne dédiée, ou charge négative référencée |

> ⚠️ Le mapping exact de la **retenue de garantie** en Factur-X n'est pas figé par EN 16931 ; les codes `AllowanceCharge` (UNTDID 5189/7161) et la place (allowance document vs payment terms) doivent être **confirmés sur la documentation du Portail Public de Facturation** avant implémentation. Ne pas l'inventer.

### 4.3 Ce que `EXTENDED` apporte vraiment (utile BTP)

- références de documents **multiples** (plusieurs situations/marchés liés) ;
- remises/charges et notes **au niveau ligne** plus riches (codes motif, sous-détail) ;
- informations de livraison/transport par ligne.

Recommandation : viser **EN 16931 (COMFORT)** pour la conformité, et ne basculer en **EXTENDED** que si le besoin de références multiples (chaînage de situations + avenants) le justifie.

---

## 5. Problèmes repérés dans le code actuel

1. **Signe du prorata incohérent entre chemins** :
   - `TreeNode.calculateNetToPay` : `netToPay = totalTTC − totalProrata − totalGarantie` (`TreeNode.ts:410`) → prorata **soustrait** ;
   - `calculateV2InvoiceTotals` : `netToPay = totalTTC + totalProrata − totalGarantie` (`tree-percentage.helper.ts:475`) → prorata **ajouté** ;
   - `DepositNetInvoiceStrategy` : `finalTTC − totalGarantie + totalProrata` (`deposit-net…:397, 417`) → prorata **ajouté**.

   Le front (display) et le back (valeur stockée) peuvent diverger sur le net à payer. **À trancher avec le métier** (le compte prorata est normalement une *retenue* → soustrait).

2. **`bankGuaranty` ignoré côté helper V2** : `calculateV2InvoiceTotals` soustrait toujours la garantie, sans tester `bankGuaranty` (contrairement à `TreeNode.calculateNetToPay`). Une caution bancaire donnerait un net à payer faux sur les situations générées par cette voie.

3. **Rustines d'arrondi** (`getVatRemainder`, dernier = reste, `adjustToRestIfClose`) : nécessaires uniquement à cause de l'arrondi intermédiaire. Disparaissent avec le modèle plat Decimal de `analyse.md`.

4. **Avenant non modélisé** (§2.6) : risque sur la continuité référence ↔ situations.

5. **`setToMax` (front) ré-active tout le pipeline `calculate*`** (`TreePercentageProvider.tsx:657-669`) y compris `calculateNetToPay` (prorata soustrait) — incohérent avec la valeur que le back recalculera (prorata ajouté). Même cause que (1).

---

## 6. Cible : une facture = un `EN16931Invoice` plat

En prolongeant le bridge de `doc/analyse.md`, chaque facture BTP devient un document plat construit en une passe :

```
EN16931Invoice (situation N) = {
  lines:        flattenTree(référence, %avancement par nœud)   // BT-129/146/131
  documentAllowances: [
     remiseGlobale (par groupe TVA),
     compteProrata (base HT),
     retenueGarantie (si pas de caution bancaire),
  ],
  prepaidAmount: Σ acomptes pioché + Σ situations précédentes,  // BT-112
  precedingInvoiceRefs: [acompte, situations N-1…],             // BG-3
}
→ calcul EN 16931 standard → BT-109/110/111/112/115
```

Avantages : le « rest », le « VAT remainder » et le « dernier = reste » deviennent **un simple `BT-112 = Σ déjà facturé`** ; garantie/prorata sont des `AllowanceCharge` explicites ; l'avenant = changement de l'arbre de référence versionné ; tout est testable (golden tests par situation).

---

## 7. Décisions ouvertes à trancher

1. **Prorata** : soustrait ou ajouté au net à payer ? (corriger l'incohérence §5.1)
2. **Retenue de garantie** en Factur-X : `AllowanceCharge` document **ou** conditions de paiement ? (valider PPF)
3. **Majoration globale** : prix article `BT-146` ou charge document `BT-99` ? (rappel `analyse.md`)
4. **Avenant** : arbre de référence versionné + référence de marché EN 16931 ?
5. **Profil cible** : EN 16931 (COMFORT) suffisant, ou EXTENDED pour le chaînage situations/avenants ?
