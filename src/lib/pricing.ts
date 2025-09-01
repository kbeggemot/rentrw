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
  const targetAgent = round2(Math.min(Math.max(rawA, 0), total));

  // Step 2: compute adjusted per-item sums according to the user rules
  const baseSums = safeItems.map((it) => ({ sum: round2(Number(it.price) * Number(it.qty)), qty: Number(it.qty) }));
  let adjustedSums: number[] = [];

  if (commissionType === 'percent') {
    // Decrease each item's sum by the same percentage
    const k = (100 - commissionValue) / 100;
    adjustedSums = baseSums.map(({ sum }) => round2(sum * k));
  } else {
    // Fixed: distribute targetAgent proportionally to position sums
    const weights = baseSums.map(({ sum }) => (sum <= 0 ? 0 : sum / total));
    adjustedSums = baseSums.map(({ sum }, i) => {
      const dec = round2(targetAgent * weights[i]);
      const val = round2(sum - dec);
      return val < 0 ? 0 : val;
    });
  }

  // Step 3: rounding reconciliation so that sum(adjusted) + agentAmount ≈ total (to 2 decimals)
  const sumAdj = round2(adjustedSums.reduce((s, v) => s + v, 0));
  // we shift the residual into the commission line (позиционная комиссия)
  let agentAmount = round2(total - sumAdj);

  // Step 4: convert back to per-unit prices
  const adjusted: CartItem[] = safeItems.map((it, i) => {
    const qty = Number(it.qty);
    const unit = qty > 0 ? round2(adjustedSums[i] / qty) : 0;
    return { title: it.title, price: unit, qty };
  });
  return { total, agentAmount, adjusted };
}


