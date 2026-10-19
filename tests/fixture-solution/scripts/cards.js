// icon helpers
export function cardIcon(brand) {
  const icons = { visa: 'credit-card-visa', other: 'credit-card-1-alternate' }
  return { title: brand, icon: icons[brand] || 'credit-card-1-alternate' }
}
export const FALLBACK = 'server-network'
