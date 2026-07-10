export function renderFinalTaskAnchor(questionReference, priorityBasis) {
  return `## Final Task Anchor\n\n- 最终要回答的问题：${questionReference.finalText}\n- 回答时优先遵守：${priorityBasis}。\n- 如果上下文不足、过时或互相冲突，请明确说明，不要强行合并。\n- 不要被长上下文带偏；所有材料都必须回到 Current Question。`;
}
