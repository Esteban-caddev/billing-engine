import { Decimal } from '../config'
import { BillingInput, FlatLine } from '../model'

/**
 * Applique le mode de facturation aux lignes du marché.
 *
 *   - 'full'        : devis / 100 % (identité)
 *   - 'advancement' : situation = lignes × % d'avancement par nœud (BT-129 × %)
 *   - 'deposit'     : échéance = lignes × %
 *
 * Le devis est donc le cas particulier `mode: 'full'`. cf. doc/facturation-btp.md
 * et doc/billing-engine-structure.md §2.4.
 */
export function applyBilling(lines: FlatLine[], input: BillingInput): FlatLine[] {
  if (input.mode === 'full') {
    // Retourne une copie des lignes inchangées
    return lines.map((line) => ({ ...line }))
  }

  // 'advancement' ou 'deposit' : on multiplie la quantité par le % par nœud
  return lines.map((line) => {
    const pct = new Decimal(
      input.percentByNodeKey?.[line.lineId] ?? 0
    )
    const newQuantity = line.quantity.times(pct).div(100)
    return {
      ...line,
      quantity: newQuantity,
    }
  })
}
