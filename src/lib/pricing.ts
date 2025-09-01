export type CartItem = { title: string; price: number; qty: number };

function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

export function applyAgentCommissionToCart(
  items: CartItem[],
  commissionType: 'percent' | 'fixed',
  commissionValue: number
): { total: number; agentAmount: number; adjusted: CartItem[] } {
  const safeItems = (items || []).filter((i) => Number(i.price) > 0 && Number(i.qty) > 0);
  const total = round2(safeItems.reduce((s, r) => s + Number(r.price) * Number(r.qty), 0));
  if (total <= 0) return { total: 0, agentAmount: 0, adjusted: safeItems.map((i) => ({ ...i })) };

  // Step 1: compute target agentAmount from original totals
  const rawA = commissionType === 'percent' ? (total * (commissionValue / 100)) : commissionValue;
  let agentAmount = round2(Math.min(Math.max(rawA, 0), total));

  // Step 2: compute adjusted per-item sums according to the user rules
  const baseSums = safeItems.map((it) => ({ sum: round2(Number(it.price) * Number(it.qty)), qty: Number(it.qty) }));
  let adjustedSums: number[] = [];

  if (commissionType === 'percent') {
    // Decrease each item's sum by the same percentage
    const k = (100 - commissionValue) / 100;
    adjustedSums = baseSums.map(({ sum }) => round2(sum * k));
  } else {
    // Fixed: distribute agentAmount proportionally by quantity
    const totalQty = baseSums.reduce((s, x) => s + x.qty, 0);
    if (totalQty <= 0) return { total, agentAmount: 0, adjusted: safeItems.map((i) => ({ ...i })) };
    const perUnit = agentAmount / totalQty; // exact, then round on per-item level below
    adjustedSums = baseSums.map(({ sum, qty }) => round2(sum - round2(perUnit * qty)));
  }

  // Step 3: rounding reconciliation so that sum(adjusted) + agentAmount ≈ total (to 2 decimals)
  const sumAdj = round2(adjustedSums.reduce((s, v) => s + v, 0));
  let diff = round2(total - (sumAdj + agentAmount));
  if (Math.abs(diff) >= 0.01) {
    // Push residual into a dedicated positional component: the item with max base sum
    let idx = 0; let max = -Infinity;
    for (let i = 0; i < baseSums.length; i++) { if (baseSums[i].sum > max) { max = baseSums[i].sum; idx = i; } }
    adjustedSums[idx] = round2(adjustedSums[idx] + diff);
    // update agentAmount to keep identity total == sum(adjusted)+agentAmount
    agentAmount = round2(total - adjustedSums.reduce((s, v) => s + v, 0));
  }

  // Step 4: convert back to per-unit prices
  const adjusted: CartItem[] = safeItems.map((it, i) => {
    const qty = Number(it.qty);
    const unit = qty > 0 ? round2(adjustedSums[i] / qty) : 0;
    return { title: it.title, price: unit, qty };
  });
  return { total, agentAmount, adjusted };
}


