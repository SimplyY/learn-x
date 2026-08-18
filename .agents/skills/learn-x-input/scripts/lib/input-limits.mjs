export const MAX_WEEKLY_INPUT_CHARS = 15_000;

export function countInputChars(value) {
  return Array.from(String(value)).length;
}

export function inputSize(value) {
  const text = String(value);
  return { chars: countInputChars(text), bytes: Buffer.byteLength(text, "utf8") };
}

export function assertWeeklyInputSize(value, label) {
  const size = inputSize(value);
  if (size.chars > MAX_WEEKLY_INPUT_CHARS) {
    throw new Error(`${label} 超过周输入上限：${size.chars} 字符（上限 ${MAX_WEEKLY_INPUT_CHARS}）。请先运行批量压缩预览，人工确认后再应用候选。`);
  }
  return size;
}
