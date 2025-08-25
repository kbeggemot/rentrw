export interface SaleRecord {
  userId: string;
  taskId: string | number;
  orgInn?: string | null;
  amount?: number | null;
  commission?: number | null;
  vatRate?: string | null;
  isAgent?: boolean;
  commissionType?: string | null;
  method?: string | null;
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  createdAtRw?: string | null;
  updatedAtRw?: string | null;
  orderId?: number | null;
  receiptId?: string | null;
  invoiceId?: string | null;
  type?: string | null;
  clientEmail?: string | null;
  description?: string | null;
  amountGrossRub?: number | null;
  retainedCommissionRub?: number | null;
  rootStatus?: string | null;
  ofdUrl?: string | null;
  ofdFullUrl?: string | null;
  ofdPrepayId?: string | null;
  ofdFullId?: string | null;
  additionalCommissionOfdUrl?: string | null;
  npdReceiptUri?: string | null;
  serviceEndDate?: string | null;
  hidden?: boolean;
  invoiceIdPrepay?: string | null;
  invoiceIdOffset?: string | null;
  invoiceIdFull?: string | null;
  rwTokenFp?: string | null;
  rwOrderId?: number | null;
}

export interface PartnerRecord {
  uid: string;
  phone: string;
  fio?: string | null;
  status?: string | null;
  inn?: string | null;
  hidden?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentLink {
  code: string;
  userId: string;
  orgInn?: string | null;
  sumMode: string;
  vatRate: string;
  isAgent: boolean;
  commissionType: string;
  method: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationRecord {
  inn: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}
