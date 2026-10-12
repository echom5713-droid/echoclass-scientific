export type Language = "en" | "zh";

export function parseLanguage(value: unknown): Language | undefined {
  return value === "en" || value === "zh" ? value : undefined;
}

export function languageFor(url: URL, cookies: Record<string, string>): Language {
  const requested = url.searchParams.getAll("lang");
  return (
    (requested.length === 1 ? parseLanguage(requested[0]) : undefined) ??
    parseLanguage(cookies.echoclass_language) ??
    "en"
  );
}

export function languageSwitch(path: string, language: Language): string {
  let target = new URL("http://language.internal/");
  try {
    const candidate = new URL(path, target);
    const fixed = [
      "/",
      "/engineering",
      "/walkthrough",
      "/account/password",
      "/student/login",
      "/teacher/login",
      "/admin/login",
      "/csv",
    ];
    const allowed =
      candidate.pathname === "/evidence"
        ? ["record_id", "batch_id"]
        : candidate.pathname === "/scientific-analysis"
          ? ["class_id"]
          : [];
    if (
      path.startsWith("/") &&
      !path.startsWith("//") &&
      candidate.origin === target.origin &&
      !candidate.hash &&
      (fixed.includes(candidate.pathname) ||
        ["/scientific-analysis", "/evidence"].includes(candidate.pathname) ||
        /^\/(?:scientific|grounded)-analysis\/runs\/[A-Za-z0-9_-]{1,128}$/.test(
          candidate.pathname,
        )) &&
      validPresentationQuery(candidate, allowed) &&
      (candidate.pathname !== "/evidence" ||
        allowed.filter((key) => candidate.searchParams.has(key)).length === 1) &&
      allowed.every(
        (key) =>
          !candidate.searchParams.has(key) ||
          (Boolean(candidate.searchParams.get(key)) &&
            candidate.searchParams.get(key)!.length <= 128),
      )
    )
      target = candidate;
  } catch {
    /* Fall back to the public project page for invalid links. */
  }
  const href = (choice: Language) => {
    const url = new URL(target);
    url.searchParams.set("lang", choice);
    return `${url.pathname}${url.search}`.replaceAll("&", "&amp;");
  };
  return `<nav class="language-switch" aria-label="${language === "zh" ? "界面语言" : "Display language"}"><a href="${href("en")}" lang="en"${language === "en" ? ' aria-current="true"' : ""}>EN</a><span aria-hidden="true">/</span><a href="${href("zh")}" lang="zh"${language === "zh" ? ' aria-current="true"' : ""}>中文</a></nav>`;
}

/** Locale parameters belong only to HTML views; API query contracts stay unchanged. */
export function validPresentationQuery(url: URL, allowed: string[] = []): boolean {
  return [...url.searchParams.keys()].every(
    (key) =>
      (key === "lang" || allowed.includes(key)) &&
      url.searchParams.getAll(key).length === 1 &&
      (key !== "lang" || parseLanguage(url.searchParams.get(key)) !== undefined),
  );
}

export function localizedOperationPath(path: string): boolean {
  return (
    ["/scientific-analysis", "/csv", "/evidence"].includes(path) ||
    /^\/(?:scientific|grounded)-analysis\/runs\/[A-Za-z0-9_-]{1,128}$/.test(path)
  );
}
