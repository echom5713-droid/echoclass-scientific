import assert from "node:assert/strict";
import test from "node:test";
import { languageFor, languageSwitch } from "../src/shared/language.js";
import { projectPage, engineeringPage } from "../src/views/project-page.js";
import { passwordPage, loginPage } from "../src/views/password-page.js";
import type { Session } from "../src/domain/types.js";

test("project language defaults to English; only one valid query can override the saved choice", () => {
  assert.equal(languageFor(new URL("https://example.test/"), {}), "en");
  assert.equal(languageFor(new URL("https://example.test/?lang=zh"), {}), "zh");
  assert.equal(
    languageFor(new URL("https://example.test/?lang=en"), { echoclass_language: "zh" }),
    "en",
  );
  assert.equal(
    languageFor(new URL("https://example.test/engineering"), { echoclass_language: "zh" }),
    "zh",
  );
  for (const query of ["?lang=fr", "?lang=%3Cscript%3E", "?lang=en&lang=zh"])
    assert.equal(
      languageFor(new URL("https://example.test/" + query), { echoclass_language: "zh" }),
      "zh",
    );
  assert.equal(
    languageFor(new URL("https://example.test/"), { echoclass_language: "unknown" }),
    "en",
  );
  assert.doesNotMatch(languageSwitch('//evil.test/" onclick="attack()', "zh"), /evil|onclick/);
});

test("English and Chinese project pages retain identical data tables, mathematical expressions and plot geometry", () => {
  for (const render of [projectPage, engineeringPage]) {
    const en = render(),
      zh = render("zh");
    assert.match(en, /<html lang="en">/);
    assert.match(zh, /<html lang="zh-CN">/);
    assert.match(zh, /项目介绍/);
    assert.match(en, />EN<|>中文</);
    for (const expression of [
      /<path[^>]+d="[^"]+"/g,
      /<circle[^>]*>/g,
      /<td>[^<]+<\/td>/g,
      /<pre>[\s\S]*?<\/pre>/g,
    ])
      assert.deepEqual(zh.match(expression), en.match(expression));
  }
  const zh = engineeringPage("zh");
  assert.match(zh, /独立高斯噪声/);
  assert.match(zh, /先验概率及误判代价相同/);
  assert.match(zh, /不能识别任意响应曲线/);
  assert.match(zh, /4\.16%/);
  assert.match(zh, /50%/);
  assert.match(zh, /Φ\(−\|q − f\|√n \/ \(2σ\)\)/);
  assert.match(zh, /<fieldset[^>]*disabled/);
});

test("translated account views preserve untrusted identities as escaped data and keep native form submission", () => {
  const actor: Session = {
    id: "u",
    role: "student",
    username: 'Records <img src=x onerror="attack()">',
    name: "Synthetic",
    class_name: "Class A",
    status: "active",
    defaultPassword: true,
  };
  const zh = passwordPage(actor, "zh");
  assert.match(zh, /Records &lt;img/);
  assert.doesNotMatch(zh, /<img src=x/);
  assert.match(zh, /临时密码/);
  assert.match(zh, /method="POST" action="\/api\/auth\/change-password\?lang=zh"/);
  assert.match(passwordPage(actor), /Set your own/);
  assert.match(loginPage("student", "zh"), /学生/);
  assert.doesNotMatch(loginPage("student"), /value="123456"/);
  assert.match(loginPage("student", "en", true), /synthetic demonstrations only/);
  assert.match(loginPage("student", "en", false, "<script>attack()</script>"), /&lt;script&gt;/);
});
