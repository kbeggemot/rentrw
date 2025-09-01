// Build Ferma (OFD.ru) payloads for receipts

export type VatRate = 'none' | '0' | '5' | '7' | '10' | '20';

// Ferma VAT code mapping (example; adjust if Ferma expects numeric codes)
export function mapVatToFerma(v: VatRate): { vatType: string } {
  switch (v) {
    case '0': return { vatType: 'Vat0' };
    case '5': return { vatType: 'Vat5' };
    case '7': return { vatType: 'Vat7' };
    case '10': return { vatType: 'Vat10' };
    case '20': return { vatType: 'Vat20' };
    case 'none':
    default:
      return { vatType: 'VatNo' };
  }
}

// Payment method codes (Признак способа расчёта):
// 1 – Предоплата 100%; 4 – Полный расчёт
export const PAYMENT_METHOD_PREPAY_FULL = 1;
export const PAYMENT_METHOD_FULL_PAYMENT = 4;

export type ReceiptParty = 'partner' | 'org';

export type DocumentType = 'Income' | 'IncomePrepayment' | 'IncomePrepaymentOffset';

export function buildFermaReceiptPayload(params: {
  party: ReceiptParty; // партнёр или юрлицо
  partyInn: string; // ИНН того, от чьего имени чек (SupplierInn)
  description: string; // из продажи
  amountRub: number; // сумма позиции
  quantity?: number; // по умолчанию 1
  vatRate: VatRate; // из UI
  methodCode: number; // PAYMENT_METHOD_*
  orderId?: string | number;
  docType: DocumentType; // тип документа Ferma
  buyerEmail?: string | null;
  invoiceId?: string;
  withAdvanceOffset?: boolean; // добавить PaymentItems для зачёта предоплаты
  callbackUrl?: string;
  paymentAgentInfo?: { AgentType: string; SupplierInn: string; SupplierName?: string; SupplierPhone?: string };
  withPrepaymentItem?: boolean; // добавить PaymentItems с PaymentType=1
}): Record<string, unknown> {
  const qty = params.quantity && params.quantity > 0 ? params.quantity : 1;
  const price = Math.max(0, Number(params.amountRub || 0));
  const sum = Math.round((price * qty + Number.EPSILON) * 100) / 100;
  const vat = mapVatToFerma(params.vatRate);

  const items: any[] = [
    {
      Label: params.description || 'Услуги',
      Price: price,
      Quantity: qty,
      Amount: sum,
      Vat: vat.vatType,
      PaymentMethod: (typeof params.methodCode === 'number' ? params.methodCode : 1),
      PaymentType: 4,
      Measure: 'PIECE',
    },
  ];
  // Normalize PaymentAgentInfo when provided (or default for partner deals)
  const normalizedPai = (() => {
    const src = params.paymentAgentInfo ?? (params.party === 'partner' ? { AgentType: 'AGENT', SupplierInn: params.partyInn } : undefined);
    if (!src) return undefined as any;
    const out: any = {
      AgentType: src.AgentType || 'AGENT',
      SupplierInn: src.SupplierInn || params.partyInn,
    };
    // SupplierName required when AgentType present — fallback if missing
    out.SupplierName = (src.SupplierName && String(src.SupplierName).trim().length > 0)
      ? String(src.SupplierName).trim()
      : 'Исполнитель';
    // SupplierPhone не передаём по ТЗ
    return out;
  })();
  if (normalizedPai) {
    items[0].PaymentAgentInfo = normalizedPai;
  }

  const customerReceipt: Record<string, unknown> = {
    TaxationSystem: 'Common',
    Items: items,
    Payments: [ { Type: 2, Amount: sum } ],
    // Признак предмета расчёта на уровне чека (дублируем с уровня позиций)
    PaymentType: 4,
  };
  if (params.buyerEmail && params.buyerEmail.trim().length > 0) {
    (customerReceipt as any).Email = params.buyerEmail.trim();
  }
  if (normalizedPai) {
    (customerReceipt as any).PaymentAgentInfo = normalizedPai;
  }
  // PaymentItems: предоплата -> 1, зачёт предоплаты -> 2
  // Логика:
  // - when withAdvanceOffset => 2 (зачёт предоплаты)
  // - when withPrepaymentItem => 1 (полный расчёт без отложенного зачёта, но с пометкой предоплаты)
  const paymentItemType = params.withAdvanceOffset ? 2 : (params.withPrepaymentItem ? 1 : undefined);
  const paymentItems = (typeof paymentItemType === 'number') ? [{ PaymentType: paymentItemType, Sum: sum }] : undefined;
  if (paymentItems) {
    (customerReceipt as any).PaymentItems = paymentItems;
  }

  const payload: Record<string, unknown> = {
    Request: {
      Inn: '7720496561',
      SupplierInn: params.partyInn,
      Type: params.docType,
      InvoiceId: params.invoiceId,
      CustomerReceipt: customerReceipt,
      PaymentItems: paymentItems,
      CallbackUrl: params.callbackUrl,
      CallBackUrl: params.callbackUrl,
    },
  };

  return payload;
}


