// fake-lib/parse-session：返回 JINGDU_FAKE_PARSE 指向的 JSON 作为 changeset。
import { readFile } from "node:fs/promises";

export async function runParseSession({ promptFile, timeoutMs }) {
  const file = process.env.JINGDU_FAKE_PARSE;
  if (!file) throw new Error("fake parse-session: 需设置 JINGDU_FAKE_PARSE 指向 changeset JSON");
  const json = JSON.parse(await readFile(file, "utf8"));
  return {
    raw: JSON.stringify(json, null, 2),
    messageText: "fake parse session",
    json,
    meta: { promptFile, timeoutMs, fake: true }
  };
}
