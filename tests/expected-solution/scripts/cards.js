// icon helpers
export function cardIcon(brand) {
  const icons = { visa: 'brand-visa', other: 'credit-card' }
  return { title: brand, icon: icons[brand] || 'credit-card' }
}
export const FALLBACK = 'server-2'
