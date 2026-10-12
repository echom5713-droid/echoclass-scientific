import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalHash,
  canonicalize,
  hashCanonicalBytes,
  parseStrictJson,
} from "../src/domain/scientific/canonical.js";

test("JCS uses RFC 8785 Appendix B IEEE 754 number vectors", () => {
  // Source: https://www.rfc-editor.org/rfc/rfc8785#appendix-B
  const vectors = [
    ["0000000000000000", "0"],
    ["8000000000000000", "0"],
    ["0000000000000001", "5e-324"],
    ["8000000000000001", "-5e-324"],
    ["7fefffffffffffff", "1.7976931348623157e+308"],
    ["ffefffffffffffff", "-1.7976931348623157e+308"],
    ["4340000000000000", "9007199254740992"],
    ["c340000000000000", "-9007199254740992"],
    ["4430000000000000", "295147905179352830000"],
    ["44b52d02c7e14af5", "9.999999999999997e+22"],
    ["44b52d02c7e14af6", "1e+23"],
    ["44b52d02c7e14af7", "1.0000000000000001e+23"],
    ["444b1ae4d6e2ef4e", "999999999999999700000"],
    ["444b1ae4d6e2ef4f", "999999999999999900000"],
    ["444b1ae4d6e2ef50", "1e+21"],
    ["3eb0c6f7a0b5ed8c", "9.999999999999997e-7"],
    ["3eb0c6f7a0b5ed8d", "0.000001"],
    ["41b3de4355555553", "333333333.3333332"],
    ["41b3de4355555554", "333333333.33333325"],
    ["41b3de4355555555", "333333333.3333333"],
    ["41b3de4355555556", "333333333.3333334"],
    ["41b3de4355555557", "333333333.33333343"],
    ["becbf647612f3696", "-0.0000033333333333333333"],
    ["43143ff3c1cb0959", "1424953923781206.2"],
  ] as const;
  for (const [bits, expected] of vectors)
    assert.equal(canonicalize(Buffer.from(bits, "hex").readDoubleBE()), expected, bits);
  for (const bits of ["7fffffffffffffff", "7ff0000000000000", "fff0000000000000"])
    assert.throws(() => canonicalize(Buffer.from(bits, "hex").readDoubleBE()), /finite/);
});

test("JCS follows RFC UTF-16 ordering including supplementary property names", () => {
  const input = {
    "\u20ac": 5,
    "\r": 1,
    "\ufb33": 7,
    "1": 2,
    "\ud83d\ude00": 6,
    "\u0080": 3,
    "\u00f6": 4,
  };
  assert.equal(canonicalize(input), '{"\\r":1,"1":2,"\u0080":3,"ö":4,"€":5,"😀":6,"דּ":7}');
});

test("JCS emits numeric-looking keys in lexical order and recursively sorts inside arrays", () => {
  assert.equal(
    canonicalize({ z: [{ "2": true, "10": false, "": null }, 2, 1], "2": 2, "10": 10 }),
    '{"10":10,"2":2,"z":[{"":null,"10":false,"2":true},2,1]}',
  );
  assert.equal(canonicalize({ ab: 3, a: 1, aa: 2, "": 0 }), '{"":0,"a":1,"aa":2,"ab":3}');
});

test("JCS preserves Unicode data and uses ECMAScript string escaping without BOM or newline", () => {
  assert.equal(
    canonicalize('\u0000\u000f\b\t\n\f\r"\\/€😀\u2028\u2029'),
    '"\\u0000\\u000f\\b\\t\\n\\f\\r\\"\\\\/€😀\u2028\u2029"',
  );
  assert.notEqual(canonicalize("é"), canonicalize("e\u0301"));
  assert.equal(canonicalize({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(canonicalize(null), "null");
  assert.equal(canonicalize([]), "[]");
  assert.equal(canonicalize({}), "{}");
  assert.equal(canonicalize(Object.create(null)), "{}");
  assert.equal(canonicalize(Object.freeze({ a: Object.freeze([1]) })), '{"a":[1]}');
});

test("canonical hashes use exact UTF-8 bytes and stable prefixed SHA-256 digests", () => {
  assert.equal(
    canonicalHash({}),
    "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
  );
  assert.equal(
    canonicalHash({ b: 2, a: 1 }),
    "sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
  );
  assert.equal(
    hashCanonicalBytes("abc"),
    "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(canonicalHash({ b: -0, a: "😀" }), canonicalHash({ a: "😀", b: 0 }));
  assert.equal(canonicalHash("€"), hashCanonicalBytes('"€"'));
  assert.notEqual(hashCanonicalBytes("{}"), hashCanonicalBytes("{}\n"));
  assert.throws(() => hashCanonicalBytes("\ud800"), /surrogate/);
});

test("JCS rejects non-JSON values both at the root and recursively", () => {
  for (const value of [undefined, Symbol("x"), 1n, () => 1, NaN, Infinity, -Infinity]) {
    assert.throws(() => canonicalize(value), TypeError);
    assert.throws(() => canonicalize({ x: [value] }), TypeError);
  }
  for (const value of [new Date(0), new Map(), new Set(), /x/, new Number(2), new Uint8Array(1)])
    assert.throws(() => canonicalize(value), /plain/);
  assert.throws(() => canonicalize(Object.create({ inherited: 1 })), /plain/);
  class CustomArray extends Array<unknown> {}
  assert.throws(() => canonicalize(new CustomArray()), /plain/);
});

test("JCS never executes getters or toJSON and rejects hidden and symbol properties", () => {
  let invoked = false;
  const getter = {
    get value() {
      invoked = true;
      return 1;
    },
  };
  const toJSON = {
    toJSON() {
      invoked = true;
      return {};
    },
  };
  const arrayGetter = Object.defineProperty([0], "0", {
    get() {
      invoked = true;
      return 1;
    },
  });
  for (const value of [getter, toJSON, arrayGetter])
    assert.throws(() => canonicalize(value), TypeError);
  assert.equal(invoked, false);
  for (const value of [
    Object.defineProperty({}, "hidden", { value: 1 }),
    { [Symbol("hidden")]: 1 },
    Object.defineProperty([1], "0", { enumerable: false }),
    Object.assign([], { [Symbol("extra")]: 1 }),
    Object.assign([1], { extra: 2 }),
    Object.defineProperty([], "extra", { value: 1 }),
  ])
    assert.throws(() => canonicalize(value), TypeError);
});

test("JCS rejects sparse arrays, cycles and excessive depth, but permits shared acyclic values", () => {
  assert.throws(() => canonicalize(new Array(1)), /dense/);
  assert.throws(() => canonicalize(Object.assign(new Array(1), { extra: 1 })), TypeError);
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assert.throws(() => canonicalize(cycle), /cycle/);
  const arrayCycle: unknown[] = [];
  arrayCycle.push(arrayCycle);
  assert.throws(() => canonicalize(arrayCycle), /cycle/);
  const child = { b: 2, a: 1 };
  assert.equal(canonicalize([child, child]), '[{"a":1,"b":2},{"a":1,"b":2}]');
  let nested: unknown = 0;
  for (let depth = 0; depth < 64; depth += 1) nested = [nested];
  assert.equal(canonicalize(nested), `${"[".repeat(64)}0${"]".repeat(64)}`);
  assert.throws(() => canonicalize([nested]), /maximum depth/);
});

test("JCS rejects proxies before invoking any inspection traps", () => {
  let invoked = false;
  for (const target of [{ a: 1 }, [1]]) {
    const proxy = new Proxy(target, {
      getPrototypeOf() {
        invoked = true;
        return Object.prototype;
      },
      ownKeys() {
        invoked = true;
        return [];
      },
      get() {
        invoked = true;
        return 1;
      },
    });
    assert.throws(() => canonicalize(proxy), /proxies/);
  }
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.throws(() => canonicalize(revoked.proxy), /proxies/);
  assert.equal(invoked, false);
});

test("JCS and strict parsing reject lone surrogate values and keys", () => {
  for (const value of ["\ud800", "\udfff", "x\ud800y", "\ud800\ud800", "\udc00\ud800"]) {
    assert.throws(() => canonicalize(value), /surrogate/);
    assert.throws(() => canonicalize({ [value]: 1 }), /surrogate/);
    assert.throws(() => parseStrictJson(JSON.stringify(value)), /surrogate/);
    assert.throws(() => parseStrictJson(JSON.stringify({ [value]: 1 })), /surrogate/);
    assert.throws(() => parseStrictJson(`"${value}"`), /surrogate/);
  }
  for (const text of ['"😀"', '"\\ud83d\\ude00"', '"\ud83d\\ude00"', '"\\ud83d\ude00"'])
    assert.equal(parseStrictJson(text), "😀");
});

test("strict parsing preserves valid JSON primitives, member names and negative zero", () => {
  const input = ' \t\r\n{"z":[null,true,false,-0,1.20e2,"\\b\\t\\n\\f\\r\\"\\\\\\/"],"a":{}}\n';
  assert.deepEqual(parseStrictJson(input), JSON.parse(input));
  assert.equal(Object.is(parseStrictJson("-0"), -0), true);
  assert.equal(canonicalize(parseStrictJson("-0")), "0");
  assert.equal(parseStrictJson("1e-400"), 0);
  const unusual = parseStrictJson('{"__proto__":{"safe":true},"constructor":1,"toString":2}');
  assert.equal(Object.getPrototypeOf(unusual), Object.prototype);
  assert.deepEqual(unusual, JSON.parse('{"__proto__":{"safe":true},"constructor":1,"toString":2}'));
  assert.equal(canonicalize(unusual), '{"__proto__":{"safe":true},"constructor":1,"toString":2}');
});

test("strict parsing detects duplicate decoded object names at every depth", () => {
  for (const text of [
    '{"a":1,"a":2}',
    '{"a":1,"\\u0061":2}',
    '{"\\u0061":1,"a":2}',
    '{"__proto__":1,"__proto__":2}',
    '{"constructor":1,"constructor":2}',
    '{"":1,"":2}',
    '{"😀":1,"\\ud83d\\ude00":2}',
    '[{"safe":1},{"nested":{"a":1,"a":2}}]',
    '{"\\n":1,"\\u000a":2}',
  ])
    assert.throws(() => parseStrictJson(text), /Duplicate/, text);
  assert.deepEqual(parseStrictJson('[{"a":1},{"a":2}]'), [{ a: 1 }, { a: 2 }]);
  assert.deepEqual(parseStrictJson('{"é":1,"e\\u0301":2}'), { é: 1, é: 2 });
});

test("strict parsing rejects malformed syntax, nonfinite numbers and extra tokens", () => {
  for (const text of [
    "",
    " ",
    "undefined",
    "NaN",
    "Infinity",
    "-Infinity",
    "1e400",
    "-1e400",
    "01",
    "-01",
    ".1",
    "1.",
    "1e",
    "1e+",
    "+1",
    "--1",
    "0x1",
    "1_0",
    "[1,]",
    "[,1]",
    "[1 2]",
    "[",
    "{",
    '{"a":}',
    '{"a" 1}',
    '{"a":1,}',
    "{a:1}",
    "{'a':1}",
    "null true",
    "[]{}",
    "truex",
    "null0",
    "/*a*/0",
    "\ufeff{}",
    "\u00a0{}",
    "\v0",
    "0\f",
    '"\n"',
    '"\u0000"',
    '"\\x41"',
    '"\\u12"',
    '"\\uZZZZ"',
    '"\\q"',
    '"abc',
    '"abc\\',
  ])
    assert.throws(() => parseStrictJson(text), SyntaxError, JSON.stringify(text));
});

test("strict parser bounds container depth consistently for arrays and objects", () => {
  for (const [open, close] of [
    ["[", "]"],
    ['{"a":', "}"],
  ] as const) {
    const allowed = `${open.repeat(64)}0${close.repeat(64)}`;
    assert.equal(canonicalize(parseStrictJson(allowed)), allowed);
    assert.throws(() => parseStrictJson(`${open}${allowed}${close}`), /maximum depth/);
  }
  assert.throws(() => parseStrictJson("[".repeat(10_000)), /maximum depth/);
});
