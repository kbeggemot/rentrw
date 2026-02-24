export type ForeignInvoiceCurrency = 'EUR' | 'USD';

export type ForeignInvoicePaymentDetails = {
  currency: ForeignInvoiceCurrency;
  companyName: string;
  companyAddressLines: string[];
  bin: string;
  bankName: string;
  recipientName: string;
  beneficiaryAddress: string;
  bankSwift: string;
  accountOrIban: string;
  reference: string;
};

export function getForeignInvoicePaymentDetails(currencyRaw: unknown): ForeignInvoicePaymentDetails {
  const currency: ForeignInvoiceCurrency = String(currencyRaw || '').toUpperCase() === 'USD' ? 'USD' : 'EUR';
  return {
    currency,
    companyName: 'Sky Rock LLP',
    companyAddressLines: [
      'CITY OF ALMATY, ALMALI DISTRICT, ST. NURMAKOVA, 65,',
      'Apt. 10',
      '050026, Republic of Kazakhstan',
    ],
    bin: '240940015346',
    bankName: 'Xprowire Holdings Ltd',
    recipientName: 'Xprowire Holdings Ltd',
    beneficiaryAddress: '410-255 5 AVE SW, CALGARY, AB, T2P 3G6, Canada',
    bankSwift: currency === 'USD' ? 'IFXSGB2L' : 'BARCGB22',
    accountOrIban: currency === 'USD' ? 'GB45IFXS23229066452582' : 'GB22BARC20000046858244',
    reference: 'XPRO/NODA SkyRock',
  };
}
