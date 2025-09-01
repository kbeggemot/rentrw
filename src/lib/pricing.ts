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
  const rawA = commissionType === 'percent' ? (total * (commissionValue / 100)) : commissionValue;
  const agentAmount = round2(Math.min(Math.max(rawA, 0), total));
  const k = (total - agentAmount) / total;
  const baseSums = safeItems.map((it) => ({ sum: Number(it.price) * Number(it.qty) }));
  const adjustedSums = baseSums.map(({ sum }) => round2(sum * k));
  // fix rounding so that sum(adjusted) + agentAmount == total as close as possible
  const sumAdj = round2(adjustedSums.reduce((s, v) => s + v, 0));
  let diff = round2(total - (sumAdj + agentAmount));
  if (Math.abs(diff) >= 0.01) {
    // add the diff to the largest base sum item
    let idx = 0; let max = -Infinity;
    for (let i = 0; i < baseSums.length; i++) { if (baseSums[i].sum > max) { max = baseSums[i].sum; idx = i; } }
    adjustedSums[idx] = round2(adjustedSums[idx] + diff);
    diff = 0;
  }
  const adjusted: CartItem[] = safeItems.map((it, i) => {
    const qty = Number(it.qty);
    const unit = qty > 0 ? round2(adjustedSums[i] / qty) : 0;
    return { title: it.title, price: unit, qty };
  });
  return { total, agentAmount, adjusted };
}


