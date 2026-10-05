import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import test from "node:test";
import { handleChatPackPromptsLatest, handleDocumentsContext, isLocalRequest, staticResponseHeaders } from "../server.mjs";

test("local HTML is never cached across hashed asset rebuilds", () => {
  assert.equal(staticResponseHeaders(".html")["cache-control"], "no-store");
  assert.equal(staticResponseHeaders(".js")["cache-control"], undefined);
});

function contextResponse() {
  return {
    headers: {}, status: 0, payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); },
    end(body) { this.payload = JSON.parse(body); }
  };
}

const localContextRequest = { socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:4173" } };

test("local context metadata lists only discovered Documents without reading Core truth", async () => {
  const response = contextResponse();
  await handleDocumentsContext(localContextRequest, response, new URL("http://127.0.0.1:4173/api/context-files"), {
    collectFiles: async () => [{ path: "Documents/project/note.md" }],
    readContext: async () => { throw new Error("Metadata must not read truth"); }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(response.payload.files.map((file) => file.path), ["Documents/project/note.md"]);
  assert.equal(response.payload.files.some((file) => "content" in file), false);
});

test("Core file API returns live provenance and never returns stale content after failure", async () => {
  const url = new URL("http://127.0.0.1:4173/api/file?path=Core%2F%E9%81%93");
  let reads = 0;
  const readContext = async (sourcePath) => {
    if (++reads > 1) throw new Error("Core truth documents are not activated as official sources");
    return { path: sourcePath, content: "# 道\nFormal principle", live: true, revision: 3, sourceUrl: "https://example.test/dao", sha256: "hash", readAt: "2026-10-03T00:00:00.000Z" };
  };
  const success = contextResponse();
  await handleDocumentsContext(localContextRequest, success, url, { readContext });
  assert.equal(success.status, 200);
  assert.equal(success.payload.path, "Core/道");
  assert.equal(success.payload.revision, 3);
  assert.equal(success.headers["cache-control"], "no-store");
  const failure = contextResponse();
  await handleDocumentsContext(localContextRequest, failure, url, { readContext });
  assert.equal(failure.status, 400);
  assert.match(failure.payload.error, /not activated/);
  assert.equal("content" in failure.payload, false);
  assert.equal(failure.headers["cache-control"], "no-store");
});

test("context API rejects nonlocal requests before enumerating or reading Core", async () => {
  const response = contextResponse();
  await handleDocumentsContext({ socket: { remoteAddress: "10.0.0.2" }, headers: { host: "localhost:4173" } }, response,
    new URL("http://localhost:4173/api/file?path=Core%2F%E6%B3%95"), { readContext: async () => { throw new Error("must not read"); } });
  assert.equal(response.status, 403);
  assert.equal("content" in response.payload, false);
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

function jsonRequest(payload, overrides = {}) {
  const req = new EventEmitter();
  req.socket = { remoteAddress: overrides.remoteAddress || "127.0.0.1" };
  req.headers = { host: "127.0.0.1:4173", "content-type": "application/json", ...overrides.headers };
  req.setEncoding = () => {};
  process.nextTick(() => {
    if (overrides.raw !== undefined) req.emit("data", overrides.raw);
    else req.emit("data", JSON.stringify(payload));
    req.emit("end");
  });
  return req;
}

function latestAsset(promptId, content = `# ${promptId}\n\nLatest body.`) {
  return {
    contract_version: "prompt-asset/v1",
    prompt_id: promptId,
    prompt_source: `https://example.feishu.cn/wiki/${promptId}`,
    prompt_document_id: `doc-${promptId}`,
    prompt_revision: 7,
    prompt_sha256: createHash("sha256").update(content, "utf8").digest("hex"),
    prompt_fetched_at: "2026-10-04T10:00:00.000Z",
    content
  };
}

test("latest Prompt endpoint reads only registered IDs and returns complete prompt-asset/v1 values without cache", async () => {
  const calls = [];
  const response = contextResponse();
  await handleChatPackPromptsLatest(jsonRequest({ prompt_ids: ["chatpack.one", "chatpack.two"] }), response, {
    readManifest: async () => ({ assets: { "chatpack.one": {}, "chatpack.two": {} } }),
    fetchAsset: async (promptId) => { calls.push(promptId); return latestAsset(promptId); }
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(calls, ["chatpack.one", "chatpack.two"]);
  assert.deepEqual(Object.keys(response.payload.assets), calls);
  assert.equal(response.payload.assets["chatpack.two"].contract_version, "prompt-asset/v1");
  assert.equal(response.payload.assets["chatpack.two"].content, "# chatpack.two\n\nLatest body.");
});

test("latest Prompt endpoint fails closed for unregistered IDs before reading Feishu", async () => {
  let calls = 0;
  const response = contextResponse();
  await handleChatPackPromptsLatest(jsonRequest({ prompt_ids: ["chatpack.unregistered"] }), response, {
    readManifest: async () => ({ assets: { "chatpack.allowed": {} } }),
    fetchAsset: async () => { calls += 1; return latestAsset("chatpack.unregistered"); }
  });

  assert.equal(response.status, 400);
  assert.equal(calls, 0);
  assert.equal("assets" in response.payload, false);
  assert.match(response.payload.error, /not registered/);
});

test("latest Prompt endpoint does not return a partial batch when a later live read fails", async () => {
  const calls = [];
  const response = contextResponse();
  await handleChatPackPromptsLatest(jsonRequest({ prompt_ids: ["chatpack.first", "chatpack.second"] }), response, {
    readManifest: async () => ({ assets: { "chatpack.first": {}, "chatpack.second": {} } }),
    fetchAsset: async (promptId) => {
      calls.push(promptId);
      if (promptId === "chatpack.second") throw new Error("timeout");
      return latestAsset(promptId);
    }
  });

  assert.equal(response.status, 502);
  assert.deepEqual(calls, ["chatpack.first", "chatpack.second"]);
  assert.equal("assets" in response.payload, false);
  assert.equal(response.payload.prompt_id, "chatpack.second");
  assert.match(response.payload.error, /timeout/);
});

test("latest Prompt endpoint rejects invalid or mismatched prompt-asset/v1 data", async () => {
  const invalidAssets = [
    { asset: { ...latestAsset("chatpack.other"), prompt_id: "chatpack.other" }, error: /身份|contract_version/ },
    { asset: latestAsset("chatpack.first", "<fragment/>partial"), error: /完整|fragment/ },
    { asset: latestAsset("chatpack.first", "  "), error: /完整|空/ },
    { asset: { ...latestAsset("chatpack.first"), prompt_sha256: "0".repeat(64) }, error: /正文与 prompt_sha256|哈希|hash/ }
  ];
  for (const { asset, error } of invalidAssets) {
    const response = contextResponse();
    await handleChatPackPromptsLatest(jsonRequest({ prompt_ids: ["chatpack.first"] }), response, {
      readManifest: async () => ({ assets: { "chatpack.first": {} } }),
      fetchAsset: async () => asset
    });
    assert.equal(response.status, 502);
    assert.equal("assets" in response.payload, false);
    assert.match(response.payload.error, error);
  }
});

test("latest Prompt endpoint rejects nonlocal and malformed requests before prompt reads", async () => {
  let reads = 0;
  const options = { readManifest: async () => { reads += 1; return { assets: {} }; }, fetchAsset: async () => { reads += 1; } };
  const remote = contextResponse();
  await handleChatPackPromptsLatest(jsonRequest({ prompt_ids: ["chatpack.one"] }, { remoteAddress: "10.0.0.2" }), remote, options);
  assert.equal(remote.status, 403);
  assert.equal(reads, 0);

  const malformed = contextResponse();
  await handleChatPackPromptsLatest(jsonRequest({ prompt_ids: [] }), malformed, options);
  assert.equal(malformed.status, 400);
  assert.equal(reads, 0);
});
