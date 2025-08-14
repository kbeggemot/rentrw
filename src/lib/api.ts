export type ApiClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  defaultHeaders?: Record<string, string>;
};

export class ApiClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: ApiClientOptions = {}) {
    const envBaseUrl =
      typeof window === 'undefined'
        ? process.env.API_BASE_URL
        : process.env.NEXT_PUBLIC_API_BASE_URL;
    this.baseUrl = options.baseUrl ?? envBaseUrl ?? '';
    this.apiKey = options.apiKey ?? process.env.API_KEY;
    this.defaultHeaders = options.defaultHeaders ?? { 'Content-Type': 'application/json' };
  }

  private buildHeaders(extra?: Record<string, string>): HeadersInit {
    const headers: Record<string, string> = { ...this.defaultHeaders, ...(extra ?? {}) };
    if (this.apiKey && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private buildUrl(pathname: string, query?: Record<string, string | number | boolean | undefined>) {
    if (!this.baseUrl) {
      throw new Error('API base URL is not configured. Set API_BASE_URL or NEXT_PUBLIC_API_BASE_URL.');
    }
    const url = new URL(pathname.replace(/^\//, ''), this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`);
    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null) url.searchParams.set(String(key), String(value));
      });
    }
    return url.toString();
  }

  async get<T>(pathname: string, options?: { query?: Record<string, unknown>; headers?: Record<string, string> }): Promise<T> {
    const url = this.buildUrl(pathname, options?.query as Record<string, string | number | boolean | undefined>);
    const res = await fetch(url, { method: 'GET', headers: this.buildHeaders(options?.headers) });
    if (!res.ok) throw new Error(`GET ${url} failed with ${res.status}`);
    return (await res.json()) as T;
  }

  async post<T, B = unknown>(pathname: string, body?: B, options?: { headers?: Record<string, string> }): Promise<T> {
    const url = this.buildUrl(pathname);
    const res = await fetch(url, { method: 'POST', headers: this.buildHeaders(options?.headers), body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(`POST ${url} failed with ${res.status}`);
    return (await res.json()) as T;
  }
}

export const apiClient = new ApiClient();


