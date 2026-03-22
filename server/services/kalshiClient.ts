import axios from "axios";
import * as crypto from "crypto";

const BASE_URL = "https://api.elections.kalshi.com/trade-api/v2";
const API_PATH_PREFIX = "/trade-api/v2";  // Must be included in signature per Kalshi docs

export interface KalshiMarket {
  ticker: string;
  series_ticker: string;
  title: string;
  status: string;
  yes_ask: number;
  yes_bid: number;
  no_ask: number;
  no_bid: number;
  last_price: number;
  volume: number;
  open_interest: number;
  close_time: string;
  floor_strike?: number;
  cap_strike?: number;
  strike_type?: string;
}

export interface KalshiBalance {
  balance: number;
  payout: number;
}

export interface KalshiOrder {
  order_id: string;
  ticker: string;
  side: "yes" | "no";
  action: "buy" | "sell";
  count: number;
  price: number;
  status: string;
  created_time: string;
}

export interface KalshiPosition {
  ticker: string;
  position: number;
  market_exposure: number;
  realized_pnl: number;
  unrealized_pnl: number;
  total_traded: number;
  resting_orders_count: number;
}

/**
 * Sign a message using RSA-PSS with SHA-256 (Kalshi's required auth scheme ).
 * The message is: timestamp_ms + HTTP_METHOD + path_without_query
 */
function signRequest(privateKeyPem: string, method: string, path: string): { timestamp: string; signature: string } {
  const timestamp = Date.now().toString();
  // Strip query parameters from path before signing (Kalshi requirement)
  const pathWithoutQuery = path.split("?")[0];
  const message = timestamp + method.toUpperCase() + pathWithoutQuery;

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(message, "utf8");
  sign.end();

  const signature = sign.sign(
    {
      key: privateKeyPem,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    },
    "base64"
  );

  return { timestamp, signature };
}

function normalizePem(raw: string): string {
  let pem = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  pem = pem.trim();
  if (!pem.includes("\n")) {
    pem = pem.replace(/\\n/g, "\n");
  }
  pem = pem
    .replace(/(-----BEGIN [^-]+-----)\s*/g, "$1\n")
    .replace(/\s*(-----END [^-]+-----)/g, "\n$1");
  return pem;
}

export class KalshiClient {
  private privateKeyPem: string;
  private keyId: string;

  constructor(privateKeyPem: string, keyId?: string) {
    this.privateKeyPem = normalizePem(privateKeyPem);
    this.keyId = keyId ?? "";
  }


    /** Build signed headers for a request.
   * IMPORTANT: Kalshi requires the full path including /trade-api/v2 prefix in the signature.
   */
  private getHeaders(method: string, path: string ): Record<string, string> {
    // Sign with the full path including the /trade-api/v2 prefix
    const { timestamp, signature } = signRequest(this.privateKeyPem, method, API_PATH_PREFIX + path);
    return {
      "KALSHI-ACCESS-KEY": this.keyId,
      "KALSHI-ACCESS-TIMESTAMP": timestamp,
      "KALSHI-ACCESS-SIGNATURE": signature,
      "Content-Type": "application/json",
    };
  }

  private async get<T>(path: string, params?: Record<string, any>): Promise<T> {
    const url = new URL(BASE_URL + path);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined) url.searchParams.set(k, String(v));
      });
    }
    const headers = this.getHeaders("GET", path);
    const res = await axios.get(url.toString(), { headers, timeout: 10000 });
    return res.data;
  }

  private async post<T>(path: string, body: any): Promise<T> {
    const headers = this.getHeaders("POST", path);
    const res = await axios.post(BASE_URL + path, body, { headers, timeout: 10000 });
    return res.data;
  }

  private async delete<T>(path: string): Promise<T> {
    const headers = this.getHeaders("DELETE", path);
    const res = await axios.delete(BASE_URL + path, { headers, timeout: 10000 });
    return res.data;
  }

  async getBalance(): Promise<KalshiBalance> {
    return this.get<KalshiBalance>("/portfolio/balance");
  }

  async getMarkets(params: {
    series_ticker?: string;
    status?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ markets: KalshiMarket[]; cursor?: string }> {
    const raw = await this.get<{ markets: any[]; cursor?: string }>("/markets", params);
    const markets: KalshiMarket[] = (raw.markets ?? []).map((m: any) => ({
      ticker:         m.ticker,
      series_ticker:  m.series_ticker ?? m.event_ticker,
      title:          m.title,
      status:         m.status,
      // Kalshi API returns prices as dollar strings (e.g. "0.0300") — convert to cents
      yes_ask:  Math.round(parseFloat(m.yes_ask_dollars ?? "0") * 100),
      yes_bid:  Math.round(parseFloat(m.yes_bid_dollars ?? "0") * 100),
      no_ask:   Math.round(parseFloat(m.no_ask_dollars  ?? "0") * 100),
      no_bid:   Math.round(parseFloat(m.no_bid_dollars  ?? "0") * 100),
      last_price:    Math.round(parseFloat(m.last_price_dollars ?? "0") * 100),
      volume:        parseFloat(m.volume_fp ?? m.volume_24h_fp ?? "0"),
      open_interest: parseFloat(m.open_interest_fp ?? "0"),
      close_time:    m.close_time,
      floor_strike:  m.floor_strike,
      cap_strike:    m.cap_strike,
      strike_type:   m.strike_type,
    }));
    return { markets, cursor: raw.cursor };
  }

  async getMarket(ticker: string): Promise<KalshiMarket> {
    const data = await this.get<{ market: KalshiMarket }>(`/markets/${ticker}`);
    return data.market;
  }

  async createOrder(params: {
    ticker: string;
    action: "buy" | "sell";
    side: "yes" | "no";
    count: number;
    type: "limit" | "market";
    yes_price?: number;
    no_price?: number;
    client_order_id?: string;
  }): Promise<{ order: KalshiOrder }> {
    return this.post("/portfolio/orders", params);
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.delete(`/portfolio/orders/${orderId}`);
  }

  async getOrders(params?: {
    ticker?: string;
    status?: string;
    limit?: number;
  }): Promise<{ orders: KalshiOrder[] }> {
    return this.get("/portfolio/orders", params);
  }

  async getPositions(): Promise<{ market_positions: KalshiPosition[] }> {
    return this.get("/portfolio/positions");
  }

  async getFills(params?: {
    ticker?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ fills: any[]; cursor?: string }> {
    return this.get("/portfolio/fills", params);
  }

  async getPortfolioSettlements(params?: {
    limit?: number;
    cursor?: string;
    settled_after?: string;
  }): Promise<{ settlements: any[]; cursor?: string }> {
    return this.get("/portfolio/settlements", params);
  }

  isConfigured(): boolean {
    return !!this.privateKeyPem && !!this.keyId;
  }
}
