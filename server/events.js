// A live line to Little Wallet: the phone keeps one request open and hears the moment a friend pays.
// Server-Sent Events, so it works through any proxy with plain HTTP.

export function createEvents({ heartbeat = 25_000 } = {}) {
  const clients = new Set();

  return {
    get count() { return clients.size; },

    /** Keeps `res` open as an event stream until the phone hangs up. */
    attach(req, res) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write("retry: 3000\n\n");
      clients.add(res);
      // Proxies close quiet connections; a comment every so often keeps this one open.
      const beat = setInterval(() => res.write(": beat\n\n"), heartbeat);
      req.on("close", () => { clearInterval(beat); clients.delete(res); });
    },

    /** Tells every connected phone, e.g. ("share.paid", { split, person, amount, via }). */
    send(type, data) {
      const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const res of clients) res.write(message);
    },
  };
}
