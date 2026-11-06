import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSplitServer } from "../server/index.js";

const repo = new URL("../", import.meta.url).pathname;

test("the pay page and PayPal show the app that made the split", async () => {
  const root = await mkdtemp(join(tmpdir(), "lf-brand-"));
  await mkdir(join(root, "data"));
  await copyFile(join(repo, "data/demo.json"), join(root, "data/demo.json"));
  let order;
  const paypalRequest = async (_, path, body) => { if (path === "/v2/checkout/orders") { order = body; return { id: "O1" }; } throw new Error(path); };
  const server = await createSplitServer({ root, paypalRequest, env: { ORGANIZER_VENMO: "evan-z" }, log: () => {} });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  const base = "http://127.0.0.1:" + server.address().port;
  const post = (path, body) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const split = app => ({ id: "s" + (app || "fridge"), ...(app ? { app } : {}), title: "Dinner", organizer: { id: "me" },
    people: { me: { name: "Jamie" }, sam: { name: "Sam" } }, lines: [{ name: "Noodles", price: "10.00", people: ["sam"] }] });
  const tokenOf = async body => new URL((await (await post("/api/splits", body)).json()).shares.sam.link).pathname.split("/").pop();
  try {
    const wallet = await tokenOf(split("wallet"));
    const page = await (await fetch(`${base}/api/shares/${wallet}`)).json();
    assert.deepEqual(page.app, { name: "Little Wallet", logo: "/img/wallet.png" });
    assert.match(JSON.stringify(page.venmo), /Little%20Wallet|Little\+Wallet|Little Wallet/);
    assert.equal((await post(`/api/shares/${wallet}/order`, {})).status, 200);
    assert.equal(order.application_context.brand_name, "Little Wallet");

    const fridge = await tokenOf(split());
    assert.equal((await (await fetch(`${base}/api/shares/${fridge}`)).json()).app.name, "Little Fridge", "no app means Little Fridge");
    assert.equal((await (await fetch(`${base}/api/shares/demo-sam`)).json()).app.name, "Little Fridge", "existing splits stay as they were");

    const odd = await tokenOf({ ...split("nonsense"), id: "sodd" });
    assert.equal((await (await fetch(`${base}/api/shares/${odd}`)).json()).app.name, "Little Fridge");
  } finally {
    server.close();
  }
});

test("splits survive a restart in DATA_DIR", async () => {
  const root = await mkdtemp(join(tmpdir(), "lf-root-")), disk = join(await mkdtemp(join(tmpdir(), "lf-disk-")), "var", "data");
  await mkdir(join(root, "data"));
  await copyFile(join(repo, "data/demo.json"), join(root, "data/demo.json"));
  const start = async () => {
    const server = await createSplitServer({ root, paypalRequest: async () => ({}), env: { DATA_DIR: disk }, log: () => {} });
    await new Promise(ok => server.listen(0, "127.0.0.1", ok));
    return [server, "http://127.0.0.1:" + server.address().port];
  };
  let [server, base] = await start();
  const made = await (await fetch(base + "/api/splits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    id: "skeep", app: "wallet", title: "Dinner", organizer: { id: "me" }, people: { me: { name: "Jamie" }, sam: { name: "Sam" } }, lines: [{ name: "Noodles", price: "10.00", people: ["sam"] }] }) })).json();
  const token = new URL(made.shares.sam.link).pathname.split("/").pop();
  server.closeAllConnections?.(); await new Promise(ok => server.close(ok));
  [server, base] = await start();
  try {
    const page = await (await fetch(`${base}/api/shares/${token}`)).json();
    assert.equal(page.total, "10.00");
    assert.equal(page.app.name, "Little Wallet");
  } finally {
    server.closeAllConnections?.(); server.close();
  }
});
