import assert from "node:assert/strict";
import test from "node:test";
import { configureFeishuProxyRouting, configureLarkCliShim } from "./network-proxy.mjs";

test("routes Feishu through the configured proxy while preserving other bypasses", () => {
  const env = {
    HTTPS_PROXY: "http://127.0.0.1:8118",
    NO_PROXY: "localhost,127.0.0.1,::1,feishu.cn,.feishu.cn,open.feishu.cn:443,internal.example"
  };

  const result = configureFeishuProxyRouting(env);

  assert.equal(result.changed, true);
  assert.deepEqual(result.filtered, [
    { key: "NO_PROXY", entry: "feishu.cn" },
    { key: "NO_PROXY", entry: ".feishu.cn" },
    { key: "NO_PROXY", entry: "open.feishu.cn:443" }
  ]);
  assert.equal(env.NO_PROXY, "localhost,127.0.0.1,::1,internal.example");
});

test("replaces a wildcard bypass with loopback-only bypasses when a proxy is configured", () => {
  const env = { HTTP_PROXY: "http://127.0.0.1:8118", NO_PROXY: "*" };

  const result = configureFeishuProxyRouting(env);

  assert.equal(result.changed, true);
  assert.equal(env.NO_PROXY, "localhost,127.0.0.1,::1");
});

test("does not change direct-network bypasses when no proxy is configured", () => {
  const env = { NO_PROXY: "localhost,feishu.cn" };

  const result = configureFeishuProxyRouting(env);

  assert.equal(result.changed, false);
  assert.equal(env.NO_PROXY, "localhost,feishu.cn");
});

test("puts the configured lark-cli shim ahead of an unconfigured CLI and removes duplicate entries", () => {
  const env = {
    HOME: "/home/test",
    PATH: "/opt/homebrew/bin:/home/test/.local/bin:/usr/bin"
  };

  const result = configureLarkCliShim(env, { isExecutable: (candidate) => candidate === "/home/test/.local/bin/lark-cli" });

  assert.deepEqual(result, { changed: true, executable: "/home/test/.local/bin/lark-cli" });
  assert.equal(env.PATH, "/home/test/.local/bin:/opt/homebrew/bin:/usr/bin");
});

test("leaves PATH alone when the configured lark-cli shim is absent or already first", () => {
  const missing = { HOME: "/home/test", PATH: "/opt/homebrew/bin:/usr/bin" };
  const existing = { HOME: "/home/test", PATH: "/home/test/.local/bin:/opt/homebrew/bin" };

  assert.equal(configureLarkCliShim(missing, { isExecutable: () => false }).changed, false);
  assert.equal(missing.PATH, "/opt/homebrew/bin:/usr/bin");
  assert.equal(configureLarkCliShim(existing, { isExecutable: () => true }).changed, false);
  assert.equal(existing.PATH, "/home/test/.local/bin:/opt/homebrew/bin");
});
