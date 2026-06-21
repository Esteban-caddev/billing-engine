> Ok je voudrais prévoir un gros chantier dans mon ERP, j'ai un arbre infini et je pense qu'on calcul pas les choses correctement dans le bon ordre. Je voudrais me baser sur les champs de EN 16931 avec decimal js. Il me faudrait déjà la liste des champs et des règles que je puisse le donner a mon LLM pour coder un bridge entre mon arbre métier et la norme

Si tu veux refaire proprement ton moteur de calcul, je pense qu'il faut séparer complètement :

* **Le modèle métier** (ton arbre infini avec sections, sous-sections, ouvrages, CQP, etc.)
* **Le modèle fiscal/comptable EN 16931** (une facture "plate" avec des lignes et des totaux normés)
* **Le bridge** qui transforme l'arbre métier → document EN 16931.

Le bridge devient alors une fonction pure.

```ts
InvoiceTree -> EN16931Invoice -> Factur-X XML/PDF
```

Et surtout : **tous les calculs de montants doivent être faits sur le modèle EN 16931**, pas sur l'arbre. L'arbre sert uniquement à produire les lignes.

---

# 1. Les champs monétaires EN 16931

Ce sont les champs qui déterminent les calculs.

## BT-106 — Sum of invoice line net amount

Somme des montants HT des lignes.

```ts
BT_106 = Σ(BT_131)
```

---

## BT-107 — Sum of allowances on document level

Remises globales HT.

```ts
BT_107 = Σ(documentAllowances)
```

---

## BT-108 — Sum of charges on document level

Frais globaux HT.

```ts
BT_108 = Σ(documentCharges)
```

---

## BT-109 — Invoice total amount without VAT

Total HT.

```ts
BT_109 = BT_106 - BT_107 + BT_108
```

---

## BT-110 — Invoice total VAT amount

Somme des TVA.

```ts
BT_110 = Σ(BT_117)
```

---

## BT-111 — Invoice total amount with VAT

Total TTC.

```ts
BT_111 = BT_109 + BT_110
```

---

## BT-112 — Paid amount

Montants déjà payés.

Exemple :

* acomptes déjà encaissés
* règlements précédents

```ts
BT_112
```

---

## BT-113 — Rounding amount

Arrondi global.

Souvent :

```ts
0.00
```

ou

```ts
±0.01
```

---

## BT-115 — Amount due for payment

Reste à payer.

```ts
BT_115 = BT_111 - BT_112 + BT_113
```

---

# 2. Les champs de ligne

Chaque ligne doit produire ces champs.

## BT-129 — Invoiced quantity

```ts
quantity
```

Exemple :

```ts
12
```

---

## BT-130 — Unit of measure

Code UNECE.

Exemples :

```txt
H87  pièce
KGM kilogramme
MTR mètre
MON forfait
```

---

## BT-146 — Item net price

Prix unitaire HT avant remise.

```ts
unitPrice
```

---

## BT-147 — Item price discount

Remise unitaire.

```ts
unitDiscount
```

---

## BT-148 — Item gross price

Prix avant remise.

```ts
grossPrice = unitPrice + unitDiscount
```

---

## BT-131 — Invoice line net amount

Montant HT de ligne.

Formule officielle :

```ts
lineNetAmount =
(
    quantity
    × (grossPrice - unitDiscount)
)
/ baseQuantity
```

En pratique :

```ts
lineNetAmount = quantity × unitPrice
```

si pas de prix complexe.

---

## BT-151 — VAT category code

Exemple :

```txt
S  TVA normale
Z  TVA zéro
E  Exonéré
AE Autoliquidation
```

---

## BT-152 — VAT rate

```ts
20
10
5.5
0
```

---

# 3. Les totaux TVA

EN 16931 exige un regroupement par taux.

Pour chaque couple :

```txt
(VAT category, VAT rate)
```

on calcule :

---

## BT-116 — VAT category taxable amount

Base HT.

```ts
BT_116 = Σ(lineNetAmounts)
          - allowances
          + charges
```

pour ce taux.

---

## BT-117 — VAT category tax amount

Montant TVA.

```ts
BT_117 =
round(
    BT_116 × rate / 100
)
```

---

# 4. Ordre de calcul recommandé

Je te conseille fortement cet ordre :

## Étape 1

Flatten métier.

```txt
Arbre ERP
↓
Lignes facturables
```

Exemple :

```ts
[
    plomberie,
    carrelage,
    acompte,
    retenue acompte
]
```

---

## Étape 2

Calcul ligne.

Pour chaque ligne :

```ts
BT-131
```

avec Decimal.js.

---

## Étape 3

Groupement TVA.

```ts
Map<VatKey, VatBreakdown>
```

clé :

```ts
`${category}-${rate}`
```

---

## Étape 4

Calcul BT-106.

```ts
sum(lineNetAmounts)
```

---

## Étape 5

Application des remises/frais globaux.

```ts
BT_109
```

---

## Étape 6

Calcul TVA.

```ts
BT_117
BT_110
```

---

## Étape 7

Calcul TTC.

```ts
BT_111
```

---

## Étape 8

Déduction des acomptes/payés.

```ts
BT_112
BT_115
```

---

# 5. Règles d'arrondi importantes

C'est probablement le point le plus critique.

Avec Decimal.js :

## Calculs internes

Toujours conserver la précision maximale.

```ts
Decimal.set({
    precision: 40,
});
```

Ne jamais arrondir pendant les multiplications.

---

## Montants EN 16931

Les montants transmis doivent être arrondis à :

```txt
2 décimales
HALF_UP
```

Exemple :

```ts
value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
```

---

## TVA

La TVA se calcule :

```txt
par groupe de TVA
```

et non :

```txt
ligne par ligne puis somme
```

Sinon tu auras des écarts de 0,01 €.

Donc :

```ts
base TVA
↓
somme exacte Decimal
↓
arrondi 2 décimales
↓
TVA
```

et non :

```txt
TVA ligne 1 arrondie
+ TVA ligne 2 arrondie
+ TVA ligne 3 arrondie
```

---

# 6. Structure que je donnerais au LLM

```ts
type EN16931Invoice = {
    lines: InvoiceLine[];

    documentAllowances: Allowance[];
    documentCharges: Charge[];

    paidAmount: Decimal;
    roundingAmount: Decimal;
};

type InvoiceLine = {
    quantity: Decimal;
    unitCode: string;

    grossPrice: Decimal;
    unitDiscount: Decimal;

    vatCategory: string;
    vatRate: Decimal;

    lineNetAmount: Decimal;
};

type VatBreakdown = {
    category: string;
    rate: Decimal;

    taxableAmount: Decimal;
    taxAmount: Decimal;
};

type MonetarySummation = {
    lineNetTotal: Decimal;      // BT-106
    allowanceTotal: Decimal;   // BT-107
    chargeTotal: Decimal;       // BT-108
    taxExclusive: Decimal;      // BT-109
    taxTotal: Decimal;          // BT-110
    taxInclusive: Decimal;      // BT-111
    prepaid: Decimal;           // BT-112
    rounding: Decimal;          // BT-113
    payable: Decimal;           // BT-115
};
```

Le prompt que je donnerais au LLM serait :

> "À partir de mon arbre métier, génère un objet EN16931Invoice complet. Tous les calculs doivent être effectués exclusivement sur ce modèle EN 16931 avec Decimal.js. Les calculs doivent respecter l'ordre EN 16931 : calcul des lignes → regroupement TVA → totaux HT → TVA → TTC → acomptes → montant à payer. Aucun arrondi intermédiaire n'est autorisé ; seuls les montants exposés sont arrondis à 2 décimales (ROUND_HALF_UP). La TVA doit être calculée par groupe de taux et non ligne par ligne."

Je pense que cette séparation "arbre métier → bridge → moteur EN16931" va énormément simplifier ton ERP, surtout avec les cas compliqués du BTP (CQP, situations d'avancement, acomptes, retenues d'acompte, remises globales, Factur-X).

---
---

