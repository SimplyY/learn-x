import assert from "node:assert/strict";
import test from "node:test";
import { isLocalRequest, staticResponseHeaders } from "../server.mjs";

test("local HTML is never cached across hashed asset rebuilds", () => {
  assert.equal(staticResponseHeaders(".html")["cache-control"], "no-store");
  assert.equal(staticResponseHeaders(".js")["cache-control"], undefined);
});

test("usage endpoint accepts only loopback same-origin requests", () => {
  const request = (remoteAddress, host, origin) => ({
    socket: { remoteAddress },
    headers: { host, ...(origin ? { origin } : {}) }
  });
  assert.equal(isLocalRequest(request("127.0.0.1", "127.0.0.1:4173")), true);
  assert.equal(isLocalRequest(request("::1", "localhost:4173", "http://localhost:4173")), true);
  assert.equal(isLocalRequest(request("10.0.0.2", "localhost:4173")), false);
  assert.equal(isLocalRequest(request("127.0.0.1", "localhost:4173", "https://evil.example")), false);
});
