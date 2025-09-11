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

type OfdCartItemIn = {
  label: string;
  price: number;
  qty: number;
  vatRate?: VatRate;
  unit?: 'усл' | 'шт' | 'упак' | 'гр' | 'кг' | 'м';
  kind?: 'goods' | 'service';
  paymentTypeOverride?: 1 | 4; // 1 – Товар, 4 – Услуга
};

function sanitizeLabel(label: string): string {
  const s = String(label || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return s.slice(0, 128) || 'Позиция';
}

function mapUnitToMeasure(u?: OfdCartItemIn['unit']): string {
  switch (u) {
    case 'гр': return 'GRAM';
    case 'кг': return 'KILOGRAM';
    case 'м': return 'METER';
    case 'усл':
    case 'шт':
    case 'упак':
    default: return 'PIECE';
  }
}

function mapKindToPaymentType(kind?: OfdCartItemIn['kind']): number {
  return kind === 'goods' ? 1 : 4;
}

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
  items?: OfdCartItemIn[]; // массив позиций корзины (при наличии)
}): Record<string, unknown> {
  const qty = params.quantity && params.quantity > 0 ? params.quantity : 1;
  const price = Math.max(0, Number(params.amountRub || 0));
  const vat = mapVatToFerma(params.vatRate);

  const normalizedPai = (() => {
    const src = params.paymentAgentInfo ?? (params.party === 'partner' ? { AgentType: 'AGENT', SupplierInn: params.partyInn } : undefined);
    if (!src) return undefined as any;
    const out: any = { AgentType: src.AgentType || 'AGENT', SupplierInn: src.SupplierInn || params.partyInn };
    out.SupplierName = (src.SupplierName && String(src.SupplierName).trim().length > 0) ? String(src.SupplierName).trim() : 'Исполнитель';
    return out;
  })();

  let items: any[];
  if (Array.isArray(params.items) && params.items.length > 0) {
    items = params.items.map((it) => {
      const itemVat = mapVatToFerma(it.vatRate ?? params.vatRate);
      const unitPrice = Math.max(0, Number(it.price || 0));
      const quantity = (it.qty && it.qty > 0) ? it.qty : 1;
      const amount = Math.round((unitPrice * quantity + Number.EPSILON) * 100) / 100;
      const paymentType = (typeof it.paymentTypeOverride === 'number') ? it.paymentTypeOverride : mapKindToPaymentType(it.kind);
      const rec: any = {
        Label: sanitizeLabel(it.label),
        Price: unitPrice,
        Quantity: quantity,
        Amount: amount,
        Vat: itemVat.vatType,
        PaymentMethod: (typeof params.methodCode === 'number' ? params.methodCode : 1),
        PaymentType: paymentType,
        Measure: mapUnitToMeasure(it.unit),
      };
      if (normalizedPai) rec.PaymentAgentInfo = normalizedPai;
      return rec;
    });
  } else {
    const sum = Math.round((price * qty + Number.EPSILON) * 100) / 100;
    items = [{
      Label: sanitizeLabel(params.description || 'Услуги'),
      Price: price,
      Quantity: qty,
      Amount: sum,
      Vat: vat.vatType,
      PaymentMethod: (typeof params.methodCode === 'number' ? params.methodCode : 1),
      PaymentType: 4,
      Measure: 'PIECE',
      ...(normalizedPai ? { PaymentAgentInfo: normalizedPai } : {}),
    }];
  }

  const totalSum = items.reduce((s, r) => s + (Number(r?.Amount) || 0), 0);
  const sumRounded = Math.round((totalSum + Number.EPSILON) * 100) / 100;

  const customerReceipt: Record<string, unknown> = {
    TaxationSystem: 'Common',
    Items: items,
    Payments: [ { Type: 2, Amount: sumRounded } ],
    PaymentType: 4,
  };
  if (params.buyerEmail && params.buyerEmail.trim().length > 0) {
    (customerReceipt as any).Email = params.buyerEmail.trim();
  }
  if (normalizedPai) {
    (customerReceipt as any).PaymentAgentInfo = normalizedPai;
  }
  const paymentItemType = params.withAdvanceOffset ? 2 : (params.withPrepaymentItem ? 1 : undefined);
  const paymentItems = (typeof paymentItemType === 'number') ? [{ PaymentType: paymentItemType, Sum: sumRounded }] : undefined;
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
    },
  };

  return payload;
}


