import Decimal from 'decimal.js'

/**
 * Configuration Decimal.js du moteur de calcul.
 *
 * Règle d'or (cf. doc/moteur-calcul-partage.md §1) :
 *  - precision interne élevée, AUCUN arrondi intermédiaire ;
 *  - on n'arrondit QUE les valeurs exposées, une seule fois, en HALF_UP.
 */
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP })

export type Numeric = number | string | Decimal

export const ZERO = new Decimal(0)
export const HUNDRED = new Decimal(100)

/** Arrondi d'un MONTANT exposé : 2 décimales, HALF_UP. */
export const money = (d: Numeric): Decimal =>
  new Decimal(d).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)

/** Arrondi d'un PRIX UNITAIRE affiché : 4 décimales (cf. §1.3). */
export const unitPrice4 = (d: Numeric): Decimal =>
  new Decimal(d).toDecimalPlaces(4, Decimal.ROUND_HALF_UP)

export { Decimal }
