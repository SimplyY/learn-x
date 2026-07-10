import assert from "node:assert/strict";
import test from "node:test";
import { staticResponseHeaders } from "../server.mjs";

test("local HTML is never cached across hashed asset rebuilds", () => {
  assert.equal(staticResponseHeaders(".html")["cache-control"], "no-store");
  assert.equal(staticResponseHeaders(".js")["cache-control"], undefined);
});
