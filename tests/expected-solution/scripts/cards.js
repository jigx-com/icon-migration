// icon helpers
export function cardIcon(brand) {
  const icons = { visa: 'credit-card', other: 'credit-card' }
  return { title: brand, icon: icons[brand] || 'credit-card' }
}
