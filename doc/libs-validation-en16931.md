# Libs e-invoicing, ton PDF, Schematron & tests EN 16931

> Suite de `doc/moteur-calcul-partage.md`. Que réutiliser vs construire, comment embarquer ton propre PDF, comment récupérer/exécuter les Schematron officiels, et comment tester les règles EN 16931.

---

## 1. Architecture en 3 couches : réutiliser vs construire

| Couche | Construire ? | Outil |
|---|---|---|
| Arithmétique décimale | ❌ | `decimal.js` |
| **Arbre métier BTP → lignes + avancement/RG/prorata** | ✅ **toi** | `@crm/billing-engine` (cf. `moteur-calcul-partage.md`) |
| Totaux EN 16931 (BT-106…115, TVA par groupe) | ✅ (trivial une fois les lignes plates) | dans le même package |
| Sérialisation **CII / Factur-X XML** + embarquement PDF | ❌ | `@e-invoice-eu/core` ou `node-zugferd` |
| Conversion **PDF → PDF/A-3** | ❌ | Ghostscript (ou callas/iText) |
| **Validation EN 16931** (règles BR-*) | ❌ | Schematron officiel ConnectingEurope + SaxonJS |
| Validation **PDF/A-3** | ❌ | veraPDF |

> Le seul code « métier » que tu écris est la couche 2-3 (ton moteur). Tout le reste = libs/artefacts officiels qu'on **branche**.

### Libs JS de sérialisation/embarquement (juin 2026)
- **`@e-invoice-eu/core`** (TS, ESM/CJS/UMD) — EN16931 : Factur-X/ZUGFeRD, UBL, CII, XRechnung depuis JSON. ✅ supporte le « bring your own PDF ».
- **`node-zugferd`** — XML ZUGFeRD/Factur-X + embarquement PDF/A.
- **`@stackforge-eu/factur-x`** — CII + embarquement PDF/A-3b.

⚠️ Limite commune (notée par les libs elles-mêmes) : elles **ne font ni la validation Schematron officielle, ni systématiquement la conformité PDF/A-3b complète**. À traiter en plus (sections 3 & 4).

---

## 2. « Mon PDF est déjà fait » → oui, mais il doit devenir PDF/A-3

Tu génères déjà le PDF lisible (React, `core/pdf/...`). Bonne nouvelle : `@e-invoice-eu/core` permet de **fournir ton PDF** et d'y embarquer `factur-x.xml` au lieu de re-rendre depuis un tableur.

**Le vrai sujet n'est pas l'embarquement, c'est le profil PDF.** Factur-X impose un **PDF/A-3** (PDF archivable + fichier associé). Ton PDF React est presque sûrement un PDF « normal », **pas PDF/A-3**. Embarquer le XML dans un PDF non-A/3 produit un fichier **non conforme** (rejeté par le PPF / les validateurs).

### Pipeline réaliste

```
ton moteur ──► EN16931Document (plat)
                   │
                   ├─► @e-invoice-eu/core ──► factur-x.xml (CII, profil EN16931)
                   │
ton PDF React ─────┼─► [1] conversion PDF/A-3  (Ghostscript)
                   │
                   └─► [2] embarquement du XML dans le PDF/A-3  (la lib)
                           │
                           └─► [3] veraPDF  (contrôle PDF/A-3b)  +  Schematron (contrôle EN16931)
```

### [1] Conversion en PDF/A-3 (Ghostscript)

```bash
gs -dPDFA=3 -dBATCH -dNOPAUSE -dNOOUTERSAVE \
   -sColorConversionStrategy=RGB -dProcessColorModel=/DeviceRGB \
   -sDEVICE=pdfwrite -dPDFACompatibilityPolicy=1 \
   -sOutputFile=facture-a3.pdf facture.pdf
```

Pièges PDF/A-3**b** strict (veraPDF) :
- **polices embarquées et subsettées** (pas de Standard-14 non embarquées) ;
- **profil ICC sRGB embarqué** (OutputIntent) ;
- **métadonnées XMP Factur-X** (DocumentType, ConformanceLevel `EN 16931`, nom de fichier `factur-x.xml`) — généralement posées par la lib d'embarquement.

> À tester tôt sur **un** PDF réel : prends ton PDF React, fais [1]+[2]+[3], et regarde le rapport veraPDF. C'est là que se cachent 90 % des surprises (fonts, ICC). Si la conversion GS est trop fragile, l'alternative est un outil dédié (callas pdfaPilot, iText) en microservice.

> ⚠️ Vérifier dans la doc/issues de `@e-invoice-eu/core` si elle **convertit** elle-même en PDF/A-3 ou si elle **attend** déjà un PDF/A-3 en entrée. Par prudence : assure le PDF/A-3 toi-même (étape [1]) puis laisse la lib embarquer.

---

## 3. Récupérer et exécuter les Schematron EN 16931

### 3.1 Où les récupérer

Dépôt officiel : **`ConnectingEurope/eInvoicing-EN16931`**, onglet *Releases* (dernière : **v1.3.16**, 2026-04-10).
Chaque ZIP contient, pour **UBL** et **CII** :
- la source Schematron (`.sch`),
- un Schematron préprocessé,
- les **XSLT précompilés** (`.xslt`) — c'est ce qu'on exécute,
- un dossier `examples/` (documents valides/invalides → fixtures de test en or).

Factur-X étant du **CII**, tu prends les artefacts `cii/`.

> **Épingle la version** (ex. `1.3.16`) dans le repo, traite-la comme une fixture, et bump-la volontairement. C'est indépendant de la `calculationVersion` de ton moteur.

### 3.2 Deux niveaux de validation à ne pas confondre

1. **Règles modèle EN 16931** (`BR-*`, `BR-CO-*`, `BR-S-*`…) → artefacts ConnectingEurope (CII). C'est *ici* qu'on vérifie « Σ lignes = total », cohérence TVA, etc.
2. **Syntaxe + profil Factur-X/CTC** : schéma XSD CII (D16B) + règles additionnelles Factur-X et **règles PPF françaises**. À ajouter si tu vises le dépôt sur le Portail Public de Facturation.

### 3.3 Exécution en Node avec SaxonJS

Les `.xslt` sont du XSLT 2 → moteur **SaxonJS** (`saxon-js` + `xslt3`).

```bash
npm i -D saxon-js xslt3
# compiler l'XSLT en SEF (Saxon Executable Format) une fois :
npx xslt3 -xsl:cii/xslt/EN16931-CII-validation.xslt -export:en16931-cii.sef.json -nogo -t
```

```ts
import SaxonJS from 'saxon-js'

export async function validateCII(xml: string): Promise<string[]> {
  const result = await SaxonJS.transform({
    stylesheetFileName: 'en16931-cii.sef.json',
    sourceText: xml,
    destination: 'serialized',
  }, 'async')

  // sortie = rapport SVRL ; on extrait les <svrl:failed-assert>
  const svrl = result.principalResult as string
  const fails = [...svrl.matchAll(/<svrl:failed-assert[^>]*>[\s\S]*?<svrl:text>([\s\S]*?)<\/svrl:text>/g)]
  return fails.map((m) => m[1].trim())
}
```

→ 0 `failed-assert` de niveau *fatal* = conforme au modèle EN 16931.
Alternatives : Saxon-HE (Java) en CLI, ou un validateur tiers en service (Mustangproject / KoSIT / validateur en ligne) pour recouper.

---

## 4. Tests : la pyramide

Trois niveaux **distincts**, du plus rapide au plus lourd :

### Niveau 1 — Tests unitaires du **moteur** (rapides, sans XML)
Le cœur, là où tu attrapes **tes** bugs (signe prorata, RG, arrondis). Fonctions pures → golden tests + invariants.

```ts
import { describe, it, expect } from 'vitest'
import { flattenTree, computeDocument } from '@crm/billing-engine'

describe('moteur BTP', () => {
  it('exemple de référence (analyse.md §4)', () => {
    const doc = computeDocument(flattenTree(tree, opts), params)
    expect(doc.summation.taxExclusive.toFixed(2)).toBe('1379.40')
    expect(doc.summation.taxInclusive.toFixed(2)).toBe('1634.38')
  })

  it('invariants EN 16931 (propriété, n cas aléatoires)', () => {
    for (const tree of randomTrees()) {
      const doc = computeDocument(flattenTree(tree, opts), params)
      const sumLines = doc.lines.reduce((s, l) => s.plus(l.netAmount), Z)
      expect(sumLines.eq(doc.summation.lineNetTotal)).toBe(true)        // BR-CO-10
      expect(doc.summation.taxInclusive
        .eq(doc.summation.taxExclusive.plus(doc.summation.taxTotal))).toBe(true) // BR-CO-15
    }
  })

  it('Σ situations == marché', () => { /* avancement cumulé */ })
})
```

Ces tests tournent dans la CI des **deux** dépôts (back + front) sur le package partagé → garantit qu'ils calculent pareil.

### Niveau 2 — Tests de **conformité** (Schematron, plus lents)
On sérialise `EN16931Document → CII XML` puis on passe la validation §3.3.

```ts
it('la facture générée passe le Schematron CII EN16931', async () => {
  const xml = toCII(computeDocument(...))      // @e-invoice-eu/core
  const fails = await validateCII(xml)
  expect(fails).toEqual([])
})

it('les exemples officiels valides passent / les invalides échouent', async () => {
  expect(await validateCII(readExample('valid.xml'))).toEqual([])
  expect((await validateCII(readExample('invalid.xml'))).length).toBeGreaterThan(0)
})
```

Les `examples/` de l'artefact servent de **fixtures de non-régression** : ils détectent un bump d'artefact qui changerait le comportement.

### Niveau 3 — Conformité **PDF/A-3** (veraPDF, le plus lourd)
Sur le PDF final, en gate de CI (ou nightly) :

```bash
verapdf --flavour 3b facture-a3.pdf   # exit code ≠ 0 si non conforme
```

### Répartition
| Niveau | Quoi | Fréquence | Vitesse |
|---|---|---|---|
| 1 | moteur (calc) | chaque commit, 2 repos | ms |
| 2 | Schematron EN16931 | chaque commit / PR | s |
| 3 | veraPDF PDF/A-3 | PR / nightly | s–min |

---

## 5. Ce que ça change pour ton chantier

- Tu ne réécris **ni le format, ni les règles, ni le PDF/A** : tu écris la transformation métier (le moteur) et tu **branches** des artefacts/libs officiels.
- Le moteur produit un `EN16931Document` plat → `@e-invoice-eu/core` le sérialise → Ghostscript fait le PDF/A-3 → la lib embarque le XML → veraPDF + Schematron valident.
- Ton **PDF React reste ta source visuelle** ; il faut juste ajouter l'étape de conversion PDF/A-3 avant embarquement.
- Les tests Niveau 1 sont ta vraie assurance anti-incohérence (front=back) ; les Niveaux 2-3 sont l'assurance conformité réglementaire.

### Décisions ajoutées au registre
8. Lib de sérialisation : `@e-invoice-eu/core` vs `node-zugferd`.
9. Conversion PDF/A-3 : Ghostscript intégré vs microservice dédié (callas/iText).
10. Version d'artefact Schematron épinglée (ex. 1.3.16) + ajout ou non des règles PPF françaises.

---

### Sources
- @e-invoice-eu/core — https://www.npmjs.com/package/@e-invoice-eu/core · https://github.com/gflohr/e-invoice-eu
- node-zugferd — https://github.com/jslno/node-zugferd
- @stackforge-eu/factur-x — https://jsr.io/@stackforge-eu/factur-x
- Artefacts EN16931 (Schematron/XSLT, examples) — https://github.com/ConnectingEurope/eInvoicing-EN16931/releases
- PDF/A-3 & Factur-X (Ghostscript, veraPDF) — https://www.vatupdate.com/2026/04/29/e-invoicing-explained-pdf-a-3-the-hybrid-pdf-standard-for-data-embedded-archivable-documents/
- Factur-X from scratch (PDF/A-3 + CII, Node/TS) — https://dev.to/erwanbargain/factur-x-en-16931-from-scratch-pdfa-3-cii-xml-in-nodejs-typescript-3pbe
