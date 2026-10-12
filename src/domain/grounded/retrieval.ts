import { canonicalHash } from "../scientific/canonical.js";

export interface DocumentChunk {
  document_id: string;
  chunk_id: string;
  title: string;
  content: string;
  source: string;
  version: string;
  content_hash: string;
}
export interface DocumentRetriever {
  readonly corpusVersion: string;
  search(tokens: string[]): DocumentChunk[];
  source(id: string): DocumentChunk;
}
export const RETRIEVAL_VERSION = "echoclass.extractive-retrieval.v1";
const stopwords = new Set(
  "a an and are as at be by can could do does explain for from how i in is it me of on or please tell that the this to what when which why will with you your 是什么 怎么 什么 如何 为什么 可以 是否 请问 说明 解释 这个 我们 的是".split(
    " ",
  ),
);

// Pre-tokenization makes Chinese text searchable with the bundled unicode61 FTS tokenizer.
// Terms contain only letters/numbers; callers never provide FTS operators or column names.
export function retrievalTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const word of text
    .normalize("NFKC")
    .toLowerCase()
    .match(/[a-z][a-z0-9_]*|\p{Script=Han}+/gu) ?? []) {
    if (/^[a-z]/.test(word)) tokens.push(word);
    else for (let i = 0; i < word.length - 1; i++) tokens.push(word.slice(i, i + 2));
  }
  return [...new Set(tokens.filter((token) => !stopwords.has(token)))];
}

export function parseRetrievalCommand(raw: unknown): string {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).length !== 1 ||
    !("question" in raw) ||
    typeof raw.question !== "string"
  )
    throw Error("Invalid question command");
  const value = raw.question.normalize("NFKC").trim();
  if (
    !value ||
    value.length > 500 ||
    [...value].some(
      (character) => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127,
    ) ||
    /[\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(value) ||
    /[\ud800-\udfff]/u.test(value)
  )
    throw Error("Invalid question text");
  return value;
}

export function redactRetrievalQuestion(question: string): { text: string; redacted: boolean } {
  const text = question
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, " ")
    .replace(/(?:\+?\d[\d ()-]{5,}\d)/g, " ")
    .replace(/(?:姓名|学号|手机号|电话|name|student[ _-]?id)\s*[:：=]\s*[^,，;；?？。]+/gi, " ");
  return { text, redacted: text !== question };
}

export function retrieveAnswer(question: string, retriever: DocumentRetriever) {
  const cleaned = redactRetrievalQuestion(question);
  let status:
    | "sources_found"
    | "insufficient_evidence"
    | "safety_refusal"
    | "instruction_refusal"
    | "premise_caution" = "insufficient_evidence";
  let citations: DocumentChunk[] = [];
  let answer =
    "信息不足：本项目指南没有找到足够的词面依据。可尝试具体术语，如 bootstrap、人工审核或 CSV；检索不会猜测答案。";
  if (
    /(?:忽略|无视|绕过|泄露|覆盖).{0,16}(?:规则|指令|提示|系统|密钥)|(?:ignore|override|disregard|reveal).{0,30}(?:instructions?|rules?|prompt|secret)|system\s*:|系统\s*[:：]/i.test(
      question,
    )
  ) {
    status = "instruction_refusal";
    answer = "不执行问题中的指令变更、密钥请求或工具操作。这里仅检索版本化项目资料。";
  } else if (
    /培养|病原|临床|药敏|抗生素|工业|microb|pathogen|cultur|clinical|antibiotic|susceptib|industr/i.test(
      question,
    )
  ) {
    status = "safety_refusal";
    citations = [retriever.source("safety")];
    answer = "本资料不支持此类操作或决策。请查看安全边界原文。";
  } else if (
    /最优|显著|因果|保证|证明|准确率|confirmed.{0,12}optim|guarantee|significan|causal|prove|proves|perfect accuracy/i.test(
      question,
    )
  ) {
    status = "premise_caution";
    citations = [retriever.source("limitations")];
    answer =
      "先核对前提：现有项目资料不能支持确定性或过度推断的结论。相关限制如下；这不是对问题前提的认可。";
  } else {
    const tokens = retrievalTokens(cleaned.text);
    if (tokens.length > 0 && tokens.length <= 64) citations = retriever.search(tokens);
    if (citations.length) {
      status = "sources_found";
      answer =
        "找到以下项目指南原文，仅供核对方法和软件行为；这些片段不构成对任意问题的完整回答，也不确认问题前提。具体报告数值请查看上方证据卡片。";
    }
  }
  const response = {
    schema: RETRIEVAL_VERSION,
    status,
    answer,
    citations,
    limitations: [
      "只检索第一方项目说明；没有外部文献或真实实验验证。",
      "词面匹配可能漏检或错配；原文片段不等于完整答案。",
      "未调用语言模型；不评价模型质量。",
    ],
    safety_notice: status === "safety_refusal" ? "不提供培养操作、临床、药敏或工业决策。" : null,
    provider: "local-extractive",
    model: null,
    corpus_version: retriever.corpusVersion,
    prompt_version: null,
    retrieval_version: RETRIEVAL_VERSION,
    pii_redacted: cleaned.redacted,
  };
  return { ...response, answer_hash: canonicalHash(response) };
}
