// Thin PayPal REST client (adapted from gatefair). Secrets come from process.env and never reach the browser.
const base = env => (env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");

export function createPayPal(env = process.env) {
  let token = null; // { value, expires }

  async function accessToken() {
    if (token && Date.now() < token.expires) return token.value;
    const auth = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64");
    const res = await fetch(`${base(env)}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`PayPal auth failed: ${res.status} ${await res.text()}`);
    const json = await res.json();
    token = { value: json.access_token, expires: Date.now() + (json.expires_in - 60) * 1000 };
    return token.value;
  }

  return async function paypal(method, path, body, headers = {}) {
    const res = await fetch(`${base(env)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        "Content-Type": "application/json",
        // Orders are created by the Little Fridge platform on behalf of the organizer (payee).
        ...(env.PAYPAL_BN_CODE ? { "PayPal-Partner-Attribution-Id": env.PAYPAL_BN_CODE } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const err = new Error(json.message || `PayPal ${method} ${path} → ${res.status}`);
      err.status = res.status;
      err.details = json;
      throw err;
    }
    return json;
  };
}
