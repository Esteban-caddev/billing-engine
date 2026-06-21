# `@crm/billing-engine` — structure & logique d'appel

> Concrétise `doc/moteur-calcul-partage.md` (le moteur partagé) et `doc/libs-validation-en16931.md` (les libs branchées autour). Décrit l'arborescence du package, ses frontières, et **qui appelle quoi** lors de la création d'un devis puis d'une facture.

---

## 1. Principes de frontière

- **Pur & déterministe** : seule dépendance runtime `decimal.js`. Aucun NestJS / Mongoose / React / DOM / `Date.now()` / IO.
- **Entrées/sorties sérialisables** : on ne fait jamais traverser une instance de classe la frontière. En entrée un `SerializedTree` (objet plat), en sortie un `EN16931Document` (objet plat) — stockable et transmissible front↔back.
- **Le calcul vit ICI et uniquement ici.** Les apps gardent l'UI (front) et la persistance/orchestration (back). On supprime les `TreeNode.calculate*`, `tree-percentage.helper`, `getEffectiveDiscountedPrice`, et les calculs de `TreePercentageProvider`.
- **Versionné** : `calculationVersion` gravée dans chaque document produit → reproductibilité légale.

```
            ┌──────────────────── crm-client-admin (React) ───────────────────┐
            │  UI saisie arbre / % avancement   ──►  preview totaux (live)     │
            └───────────────────────────┬──────────────────────────────────────┘
                                        │ import (npm privé, version épinglée)
                          ┌─────────────▼─────────────┐
                          │     @crm/billing-engine    │   ← SOURCE UNIQUE DE CALCUL
                          │  (TS pur, decimal.js only) │
                          └─────────────▲─────────────┘
                                        │ import (même version)
            ┌───────────────────────────┴──────────────────────────────────────┐
            │  crm-back-end (NestJS)  : persistance, stratégies, e-invoicing     │
            └───────────────────────────────────────────────────────────────────┘
```

---

## 2. Arborescence du package

```
@crm/billing-engine/
├── package.json              # deps: { decimal.js }  ; exports ESM+CJS+types
├── tsconfig.json
└── src/
    ├── index.ts              # barrel : API publique uniquement
    ├── config.ts             # Decimal.set({ precision: 40, rounding: HALF_UP }) ; r2 / r4
    │
    ├── model/                # types partagés (sérialisables)
    │   ├── tree.ts           # SerializedTree, NodeValue (proposition/section/ouvrage/product…)
    │   ├── en16931.ts        # EN16931Document, ComputedLine, AllowanceCharge, VatGroup,
    │   │                     #   MonetarySummation, DocRef
    │   └── params.ts         # FlattenOptions, BillingInput, DocumentParams, DisplayOptions
    │
    ├── bridge/               # arbre métier -> lignes plates  (cf. analyse.md §4.3)
    │   ├── walkTree.ts       # parcours read-only + contexte (qtyFactor, priceFactor)
    │   ├── flattenTree.ts    # SerializedTree -> FlatLine[]
    │   ├── vatCategory.ts    # VatRate -> BT-151 (S/Z/E/AE…)
    │   └── unitCode.ts       # Unit -> code UNECE BT-130
    │
    ├── billing/              # couche facturation (devis = cas particulier)
    │   ├── applyBilling.ts   # mode full | advancement | deposit ; % par nœud
    │   ├── alreadyInvoiced.ts# Σ situations précédentes − avoirs  -> prepaid (BT-112)
    │   └── btpRules.ts       # RG (+ bankGuaranty), compte prorata, signes arrêtés
    │
    ├── compute/              # totaux EN 16931
    │   ├── computeDocument.ts# FlatLine[] + params -> EN16931Document
    │   ├── vatBreakdown.ts   # regroupement (catégorie, taux) -> BT-116/117
    │   └── invariants.ts     # asserts BR-CO-10/13/15… (actifs en dev/test)
    │
    ├── display/
    │   └── toDisplay.ts      # modèle d'affichage PDF (prix unitaire 4 déc., règles arrondi)
    │
    ├── versioning/
    │   └── calculationVersion.ts   # registre des versions de règles
    │
    └── __tests__/
        ├── golden/           # fixtures (dont l'exemple analyse.md §4)
        ├── golden.spec.ts
        └── invariants.spec.ts
```

### API publique (`index.ts`)

```ts
export { flattenTree } from './bridge/flattenTree'
export { applyBilling } from './billing/applyBilling'
export { computeDocument } from './compute/computeDocument'
export { toDisplay } from './display/toDisplay'
export { CALCULATION_VERSION } from './versioning/calculationVersion'
export type {
  SerializedTree, EN16931Document, ComputedLine, AllowanceCharge,
  VatGroup, MonetarySummation, BillingInput, DocumentParams, DisplayModel,
} from './model'
```

### Le pipeline en une ligne

```ts
const lines = flattenTree(tree, flattenOpts)            // arbre -> lignes plates
const billed = applyBilling(lines, billingInput)        // %, acomptes, déjà facturé
const doc    = computeDocument(billed, documentParams)  // -> EN16931Document (+ invariants)
const view   = toDisplay(doc, displayOpts)              // -> rendu PDF
```

> **Devis = `applyBilling(lines, { mode: 'full' })`** (100 %, prepaid 0). La facturation réutilise le même chemin avec un autre `BillingInput`. Un seul code, zéro divergence.

---

## 3. Schéma d'appel — création de **DEVIS**

Le devis n'est en général **pas** e-facturé (Factur-X concerne les factures). Le flux s'arrête au calcul + PDF visuel.

```
FRONT (édition live)                         @crm/billing-engine                 BACK (persistance)
────────────────────                         ───────────────────                 ──────────────────
utilisateur édite l'arbre
(prix, qté, remises, maj globale)
        │
        ├─ à chaque changement ─────────────►  flattenTree(tree, opts)
        │                                      applyBilling(lines, {mode:'full'})
        │                                      computeDocument(...)  ──► EN16931Document
        │  ◄─── toDisplay(doc) ─────────────── (totaux affichés en direct)
        │
   "Enregistrer le devis"
        │  POST offer { serializedTree, paymentCondition, … }
        └──────────────────────────────────────────────────────────────────────►  recompute
                                              flattenTree / applyBilling(full) ◄──  (source de vérité)
                                              computeDocument(...)            ──►  EN16931Document
                                                                                   stocke :
                                                                                   - offer.propositionTree
                                                                                   - offer.document (snapshot)
                                                                                   - calculationVersion
        ◄───────────────────────────────────────────────────────────────────────  200 OK
   "Télécharger PDF devis"
        └──────────────────────────────────────────────────────────────────────►  PDF React (visuel)
                                              toDisplay(doc) ─────────────────────► rendu
        ◄───────────────────────────────────────────────────────────────────────  PDF
```

Points clés :
- **Front et back appellent le même package** (version épinglée) → les totaux affichés en live == ceux persistés.
- Le back **recalcule** au save (ne fait pas confiance aux montants envoyés par le front) mais avec le **même moteur**, donc résultat identique.

---

## 4. Schéma d'appel — création de **FACTURE(S)**

Ici interviennent les libs externes (`@e-invoice-eu/core`, Ghostscript, SaxonJS, veraPDF). Deux phases : **(A) calcul & persistance**, **(B) e-invoicing à la finalisation**.

### Phase A — génération de la/les facture(s) (back)

```
offer (référence)                        @crm/billing-engine
─────────────────                        ───────────────────
InvoiceFactory.select(paymentType)
   │  net | deposit | advancement | solde | avoir
   ▼
Strategy.createInvoices(ctx)
   │   pour chaque facture à émettre :
   │
   ├─► flattenTree(referenceTree)                  ──► FlatLine[]  (le marché, 100 %)
   │
   ├─► applyBilling(lines, BillingInput)           ──► FlatLine[] de la facture
   │      • advancement : % par nœud, borné par le "rest"
   │      • deposit     : % de l'échéance (dernier = reste)
   │      • avoir       : situation négative référencée
   │      • alreadyInvoiced(situations N-1 − avoirs) ─► prepaid BT-112
   │
   ├─► computeDocument(lines, DocumentParams)      ──► EN16931Document
   │      • remise/maj globale (doc allowance/charge)
   │      • compte prorata  (allowance, base HT, signe arrêté)
   │      • retenue garantie (allowance si !bankGuaranty)
   │      • precedingInvoiceRefs (BG-3 : acomptes, situations N-1)
   │      • invariants BR-CO-* vérifiés
   │
   └─► persiste : invoice + invoice.document (EN16931Document) + calculationVersion
```

> Tout ce qui était « rest / VAT remainder / dernier = reste exact / largest-remainder » disparaît : c'est `applyBilling` + `prepaid = Σ déjà facturé`, exact par construction (cf. `moteur-calcul-partage.md`).

### Phase B — e-invoicing à la finalisation (back)

```
invoice.document (EN16931Document)
        │
        ├─[1]─► @e-invoice-eu/core : toCII(document)  ──────────► factur-x.xml (CII, profil EN16931)
        │
        ├─[2]─► PDF React (visuel)  ─── facture.pdf
        │            │
        │            └─[3]─► Ghostscript (-dPDFA=3) ───────────► facture-a3.pdf  (PDF/A-3)
        │
        ├─[4]─► lib embarque factur-x.xml dans facture-a3.pdf ─► facture-facturx.pdf
        │
        ├─[5]─► VALIDATION (gate, bloquante)
        │          • SaxonJS + Schematron CII (ConnectingEurope) sur factur-x.xml
        │          • veraPDF --flavour 3b      sur facture-facturx.pdf
        │
        └─[6]─► dépôt PPF / envoi
```

Découpage des responsabilités :

| Étape | Outil | Couche |
|---|---|---|
| document métier | `@crm/billing-engine` | **toi** |
| [1] XML CII | `@e-invoice-eu/core` | lib |
| [2] PDF visuel | React (existant) | toi (UI) |
| [3] PDF/A-3 | Ghostscript | lib/outil |
| [4] embarquement | `@e-invoice-eu/core` | lib |
| [5] validation | SaxonJS + Schematron, veraPDF | artefacts officiels |
| [6] dépôt | connecteur PPF | externe |

---

## 5. Vue composant globale (qui dépend de qui)

```
                         ┌───────────────────────────┐
                         │      @crm/billing-engine   │  decimal.js
                         │  bridge · billing · compute │
                         └───────────────────────────┘
                            ▲                       ▲
          import (live UI)  │                       │  import (vérité + stratégies)
        ┌───────────────────┘                       └───────────────────┐
        │                                                                │
┌───────────────┐                                          ┌────────────────────────┐
│ crm-client-   │                                          │      crm-back-end        │
│ admin (React) │                                          │                          │
│  - édition    │                                          │  InvoiceFactory/Strategy │
│  - preview    │                                          │  persistance (Mongo)     │
└───────────────┘                                          │  e-invoicing :           │
                                                           │   @e-invoice-eu/core ──┐ │
                                                           │   Ghostscript          │ │
                                                           │   SaxonJS+Schematron   │ │
                                                           │   veraPDF              │ │
                                                           └────────────────────────┘ │
                                                                         │            │
                                                                         ▼            │
                                                              factur-x PDF/A-3 ◄──────┘
```

---

## 6. Rappels de décisions impactant la structure

- Signe **prorata** → fixé dans `billing/btpRules.ts` (un seul endroit). *(facturation-btp §5.1)*
- **bankGuaranty** → conditionne l'allowance RG dans `btpRules.ts`. *(facturation-btp §5.2)*
- **Majoration globale** : `bridge/flattenTree.ts` (fondue) **ou** `compute/computeDocument.ts` (charge doc). *(analyse §)*
- **Avenant** : `SerializedTree` versionné en référence ; `applyBilling` choisit la référence en vigueur. *(facturation-btp §2.6)*
- **Packaging** : npm privé épinglé. *(moteur-calcul-partage §2.2)*
- Lib sérialisation / conversion A-3 / version Schematron. *(libs-validation-en16931 §5)*
```
