# Billing Engine

Moteur de calcul EN 16931 / BTP (pur, Decimal.js) — partagé front/back

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
