import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { canonicalHash } from "../../domain/scientific/canonical.js";
import {
  retrievalTokens,
  type DocumentChunk,
  type DocumentRetriever,
} from "../../domain/grounded/retrieval.js";

export class SqliteDocumentRetriever implements DocumentRetriever {
  readonly corpusVersion: string;
  private readonly db = new DatabaseSync(":memory:");
  private readonly chunks = new Map<string, DocumentChunk>();
  private readonly cache = new Map<string, string[]>();
  constructor(filename: string) {
    try {
      const bytes = readFileSync(filename);
      if (bytes.length > 100_000) throw Error("Corpus too large");
      const markdown = new TextDecoder("utf-8", { fatal: true })
        .decode(bytes)
        .replaceAll("\r\n", "\n");
      const sections = markdown.split(/^## /m);
      if (
        !sections[0]?.includes("Document: echoclass-guide\nVersion: 1\n") ||
        sections.length !== 21
      )
        throw Error("Invalid corpus manifest");
      for (const section of sections.slice(1)) {
        const split = section.indexOf("\n"),
          header = section.slice(0, split);
        const match = /^([a-z]+) \| ([^\n]{1,150})$/.exec(header);
        const content = section.slice(split + 1).trim();
        if (!match || !content || content.length > 2000 || this.chunks.has(match[1]!))
          throw Error("Invalid corpus chunk");
        this.chunks.set(match[1]!, {
          document_id: "echoclass-guide",
          chunk_id: match[1]!,
          title: match[2]!,
          content,
          source: "resources/knowledge/echoclass-guide.md",
          version: "1",
          content_hash: canonicalHash(content),
        });
      }
      this.source("safety");
      this.source("limitations");
      this.corpusVersion = `echoclass-guide.v1:${canonicalHash([...this.chunks.values()])}`;
      this.db.exec(
        "CREATE VIRTUAL TABLE chunks USING fts5(chunk_id UNINDEXED, title, content, tokenize='unicode61')",
      );
      const insert = this.db.prepare("INSERT INTO chunks(chunk_id,title,content) VALUES(?,?,?)");
      for (const chunk of this.chunks.values())
        insert.run(
          chunk.chunk_id,
          retrievalTokens(chunk.title).join(" "),
          retrievalTokens(chunk.content).join(" "),
        );
      this.db.exec("PRAGMA query_only=ON");
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  source(id: string): DocumentChunk {
    const chunk = this.chunks.get(id);
    if (!chunk) throw Error("Unknown document chunk");
    return { ...chunk };
  }
  search(tokens: string[]): DocumentChunk[] {
    if (
      !tokens.length ||
      tokens.length > 64 ||
      tokens.some(
        (token) => token.length > 500 || !/^(?:[a-z][a-z0-9_]*|\p{Script=Han}{2})$/u.test(token),
      )
    )
      return [];
    const key = [...new Set(tokens)].sort().join(" ");
    const cached = this.cache.get(key);
    if (cached) return cached.map((id) => this.source(id));
    const query = [...new Set(tokens)].map((token) => `"${token}"`).join(" OR ");
    const rows = this.db
      .prepare(
        "SELECT chunk_id FROM chunks WHERE chunks MATCH ? ORDER BY bm25(chunks,0,4,1), chunk_id LIMIT 20",
      )
      .all(query);
    const ids = rows
      .map((row) => String(row.chunk_id))
      .filter((id) => {
        const chunk = this.source(id),
          available = new Set(retrievalTokens(`${chunk.title} ${chunk.content}`));
        // An explicit lexical coverage rule, not a calibrated relevance probability.
        const overlap = tokens.filter((token) => available.has(token)).length;
        return overlap / tokens.length >= 0.45;
      })
      .slice(0, 3);
    // Keep only terms actually present in returned public excerpts. Unknown/name-like
    // query terms and unsupported queries never enter the cache.
    if (
      ids.length &&
      tokens.every((token) =>
        ids.some((id) =>
          retrievalTokens(`${this.source(id).title} ${this.source(id).content}`).includes(token),
        ),
      )
    ) {
      if (this.cache.size >= 128) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, ids);
    }
    return ids.map((id) => this.source(id));
  }
  close(): void {
    this.cache.clear();
    this.db.close();
  }
}
