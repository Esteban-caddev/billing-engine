# Billing Engine

Moteur de calcul EN 16931 / BTP (pur, Decimal.js) — partagé front/back

## Features

- Conforme à la norme EN 16931 pour la facturation électronique — priorité au respect des règles sémantiques et structurelles requises par les échanges électroniques. (tests unitaire de toutes les règles)
- Calculs financiers basés sur Decimal.js : zéro utilisation de nombres flottants, précision monétaire assurée.
- Ventilation détaillée par ligne : quantités, prix unitaires, TVA, réductions et totaux.
- Spécificités règles BTP : avancement, retenue de garantie (caution bancaire), compte prorata...
    - Rattrapage de centime (cent rounding reconciliation) : mécanisme d'ajustement déterministe pour que la somme des factures corresponde exactement au total du devis après application des arrondis.
- Spécificités règles ERP : marges, couts...
- Validations métiers et invariants (BR-CO-*) chaque règle renvoie une erreur si non conforme.
- Pipeline réutilisable front/back : flattenTree → computeDocument → computeBreakdown.

## Installation

Installez le package depuis GitHub Packages :

```bash
npm install @neven-crm/billing-engine
```

### Prérequis

Vous devez avoir authentifié votre accès GitHub Packages. Créez un fichier `.npmrc` dans votre projet racine :

```
@neven-crm:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```

Ou utilisez la variable d'environnement :

```bash
npm config set //npm.pkg.github.com/:_authToken $GITHUB_TOKEN
```

## Développement

### Installation des dépendances

```bash
npm install
```

### Build

```bash
npm run build
npm run build:watch  # Mode watch
```

### Linting & Format

```bash
npm run lint      # ESLint avec auto-fix
npm run format    # Prettier
```

### Tests

```bash
npm run test
```

## Publication

Pour publier une nouvelle version :

1. Mettez à jour la version dans `package.json`
2. Buildez le projet : `npm run build`
3. Publiez : `npm publish`

Le package sera publié sur GitHub Packages automatiquement.

## Structure

- `adapter/` - Convertisseurs/adaptateurs
- `breakdown/` - Ventilation des calculs
- `costs/` - Gestion des coûts
- `display/` - Affichage/formatage
- `invariants/` - Règles invariantes
- `model/` - Modèles de données
- `pipeline/` - Pipeline de calcul
- `tree/` - Structure arborescente
- `__tests__/` - Tests unitaires
- `config.ts` - Configuration
- `index.ts` - Point d'entrée

## Licence

UNLICENSED
