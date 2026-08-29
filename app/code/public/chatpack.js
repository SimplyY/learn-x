export function renderFinalTaskAnchor(questionReference, priorityBasis) {
  return `## Final Task Anchor\n\n- 最终要回答的问题：${questionReference.finalText}\n- 回答时优先遵守：${priorityBasis}。\n- 如果上下文不足、过时或互相冲突，请明确说明，不要强行合并。\n- 不要被长上下文带偏；所有材料都必须回到 Current Question。`;
}

export function renderExecutionContract({ categoryEnabled, subtypeEnabled, enhancerEnabled }) {
  const anyMethodPrompt = subtypeEnabled || enhancerEnabled;
  const checks = [];
  if (categoryEnabled) checks.push("- 大类 Prompt 是否实际生效；");
  if (subtypeEnabled) checks.push("- 子类型 Prompt 的每个明确要求是否执行；");
  if (enhancerEnabled) checks.push("- 增强器是否实际作用；");
  if (anyMethodPrompt) {
    checks.push("- 是否被某个强主线压缩掉其他必要视角；", "- 多视角是否只是同义重复；");
  }
  checks.push("- Context 是否喧宾夺主；", "- 是否存在明确要求但最终答案没有留下有效结果的部分。");

  return `## Execution Protocol

**契约：已启用 Prompt 是执行规范，不是参考材料。**

- 已启用的大类、子类型、增强器 Prompt 中列出的步骤、层次、视角、检查项，均为必须执行项。
- 不得跳过、不得合并到实质消失、不得仅在内部想过但最终答案没有有效体现。
- 严格执行不等于机械输出模板：允许最终表达自然重组，但任何关键方法产生的洞见都不能损失。
- 多个视角必须带来差异化贡献：新变量、新因果、新约束、新反例、新尺度或新判断，至少其一。
- 增强器只能增强，不能覆盖或替代子类型 Prompt 的核心方法。

**Prompt / Context 边界**

- Prompt 决定「如何处理问题」；Context 决定「基于什么材料处理问题」。
- Context 无论多长、多相关，都不能替代或压缩 Prompt 的方法要求。
- Context 不足时，可在事实边界内继续推理，但不能因此省略分析步骤。

**输出前内部验收（不向用户展示过程）**

最终输出前逐一自检：
${checks.join("\n")}
任一项未满足，先自动修正，再输出最终答案。内部验收过程不写入最终输出，除非用户明确要求。`;
}
