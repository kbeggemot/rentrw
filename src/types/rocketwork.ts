export type RocketworkTask = {
  id?: number | string;
  status?: string;
  acquiring_order?: {
    status?: string;
    ofd_url?: string | null;
  };
  ofd_url?: string | null;
  additional_commission_ofd_url?: string | null;
  receipt_uri?: string | null;
  [key: string]: unknown;
};



