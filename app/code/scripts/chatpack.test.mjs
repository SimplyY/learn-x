import { test } from "node:test";
import assert from "node:assert/strict";
import { renderExecutionContract, renderFinalTaskAnchor } from "../public/chatpack.js";

test("完整模式：执行契约覆盖全部已启用 Prompt 自检项", () => {
  const out = renderExecutionContract({ categoryEnabled: true, subtypeEnabled: true, enhancerEnabled: true });
  assert.match(out, /^## Execution Protocol/);
  assert.match(out, /执行规范，不是参考材料/);
  assert.match(out, /大类 Prompt 是否实际生效/);
  assert.match(out, /子类型 Prompt 的每个明确要求是否执行/);
  assert.match(out, /增强器是否实际作用/);
  assert.match(out, /是否被某个强主线压缩掉其他必要视角/);
  assert.match(out, /多视角是否只是同义重复/);
  assert.match(out, /Context 是否喧宾夺主/);
  assert.match(out, /先自动修正，再输出最终答案/);
});

test("空提示词模式：不出现大类/子类型专属自检项，保留通用项", () => {
  const out = renderExecutionContract({ categoryEnabled: false, subtypeEnabled: false, enhancerEnabled: false });
  assert.match(out, /^## Execution Protocol/);
  assert.doesNotMatch(out, /大类 Prompt 是否实际生效/);
  assert.doesNotMatch(out, /子类型 Prompt 的每个明确要求是否执行/);
  assert.doesNotMatch(out, /多视角是否只是同义重复/);
  assert.match(out, /Context 是否喧宾夺主/);
  assert.match(out, /是否存在明确要求但最终答案没有留下有效结果的部分/);
});

test("增强器模式：出现增强器自检项但不出现子类型专属项", () => {
  const out = renderExecutionContract({ categoryEnabled: false, subtypeEnabled: false, enhancerEnabled: true });
  assert.match(out, /增强器是否实际作用/);
  assert.doesNotMatch(out, /子类型 Prompt 的每个明确要求是否执行/);
  assert.match(out, /多视角是否只是同义重复/);
});

test("回归：Final Task Anchor 保持既有输出", () => {
  const out = renderFinalTaskAnchor({ finalText: "Q" }, "Current Question、Assembled Prompt");
  assert.match(out, /^## Final Task Anchor/);
  assert.match(out, /Q/);
  assert.match(out, /回答时优先遵守：Current Question、Assembled Prompt。/);
});
