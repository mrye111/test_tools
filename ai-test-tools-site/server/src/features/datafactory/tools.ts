import {
  createHash,
  randomUUID,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  scryptSync,
} from "node:crypto";
import type { ToolCategory, ToolDefinition, JsonObject, JsonValue } from "./types.js";

/* ── Utility helpers ─────────────────────────────────────────── */

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function text(value: unknown, fallback = ""): string {
  return value === undefined || value === null ? fallback : String(value);
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value: unknown): boolean {
  return value === true || String(value).toLowerCase() === "true";
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

/* ── Chinese test data ───────────────────────────────────────── */

const SURNAMES = [
  "王","李","张","刘","陈","杨","黄","赵","吴","周","徐","孙","马","朱","胡","郭","何","林","罗","高",
  "郑","梁","谢","宋","唐","许","韩","冯","邓","曹","彭","曾","肖","田","董","袁","潘","于","蒋","蔡",
  "余","杜","叶","程","苏","魏","吕","丁","任","沈","姚","卢","姜","崔","钟","谭","陆","汪","范","廖",
  "石","孟","黎","金","秦","史","陶","韦","邱","贾","侯","贺","夏","江","毛","付","段","郝","方","薛",
  "闫","顾","邹","雷","熊","龚","白","龙","邵","覃","武","钱","戴","严","莫","孔","向","汤","常","施",
];

const MALE_NAMES = [
  "伟","强","磊","军","洋","勇","杰","涛","超","明","辉","刚","平","健","波","鹏","宇","浩","凯","俊",
  "峰","建","华","鑫","毅","林","斌","飞","锋","宇轩","子涵","浩然","博文","梓豪","一鸣","天佑","睿渊","弘文","哲瀚","雨泽",
];

const FEMALE_NAMES = [
  "芳","娜","敏","静","丽","艳","娟","霞","秀","玲","婷","雪","梅","琴","兰","洁","倩","晶","颖","慧",
  "洁","晓","月","悦","莹","琳","欣","瑶","媛","梦琪","忆柳","之桃","慕青","问兰","尔岚","元香","初夏","沛菡","傲珊","曼文",
];

const CITIES = [
  "北京市","上海市","广州市","深圳市","成都市","杭州市","武汉市","西安市","重庆市","南京市",
  "天津市","苏州市","长沙市","郑州市","东莞市","青岛市","沈阳市","宁波市","昆明市","合肥市",
];

const DISTRICTS = [
  "朝阳区","海淀区","福田区","南山区","锦江区","西湖区","江汉区","雁塔区","渝中区","鼓楼区",
  "浦东新区","天河区","罗湖区","武侯区","余杭区","武昌区","碑林区","江北区","建邺区","滨海新区",
];

const ROADS = [
  "中山路","解放路","建设大道","人民路","友谊路","和平街","胜利街","新华路","青年路","文化路",
  "工业大道","科技路","学府路","商业街","花园路","迎宾大道","创业路","幸福路","光明街","振兴路",
];

const COMPANY_SUFFIXES = ["科技有限公司","网络技术有限公司","信息科技有限公司","软件有限公司","电子商务有限公司","文化传媒有限公司","商贸有限公司","实业有限公司","投资有限公司","管理有限公司"];
const COMPANY_PREFIXES = ["恒","腾","云","智","创","联","盛","兴","华","瑞","博","远","翔","凯","达","拓","易","信","嘉","安"];
const COMPANY_WORDS = ["讯","通","达","软","联","智","云","数","信","创","航","源","景","盛","维","融","拓","博","易","惠"];

function generateChineseName(gender?: string): string {
  const isMale = gender === "female" ? false : gender === "male" ? true : Math.random() > 0.5;
  const givenName = isMale ? pick(MALE_NAMES) : pick(FEMALE_NAMES);
  return `${pick(SURNAMES)}${givenName}`;
}

function generatePhone(): string {
  const prefixes = ["138", "139", "135", "136", "137", "150", "151", "152", "157", "158", "159", "182", "183", "187", "188", "130", "131", "132", "155", "156", "185", "186"];
  return `${pick(prefixes)}${pad(randomInt(0, 9999), 4)}${pad(randomInt(0, 9999), 4)}`;
}

function generateEmail(name?: string): string {
  const local = name ? name.charCodeAt(0).toString(16) + randomInt(100, 999) : `user${randomInt(1000, 99999)}`;
  const domains = ["qq.com", "163.com", "gmail.com", "outlook.com", "sina.com", "sohu.com", "126.com", "foxmail.com"];
  return `${local}@${pick(domains)}`;
}

function generateIdCard(birth?: string): string {
  const areaCodes = ["110105", "310115", "440106", "440305", "510107", "330106", "420106", "610113", "500103", "320106"];
  const area = pick(areaCodes);
  const date = birth || `${randomInt(1960, 2005)}${pad(randomInt(1, 12), 2)}${pad(randomInt(1, 28), 2)}`;
  const seq = pad(randomInt(1, 999), 3);
  const prefix = `${area}${date}${seq}`;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checkMap = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"];
  let sum = 0;
  for (let i = 0; i < 17; i += 1) sum += Number(prefix[i]) * weights[i];
  return `${prefix}${checkMap[sum % 11]}`;
}

function luhnChecksum(digits: string): number {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return (10 - (sum % 10)) % 10;
}

function generateBankCard(): string {
  const bins = ["622202", "622848", "621700", "622700", "623668", "622262", "622588", "621483", "622208", "621226"];
  const prefix = pick(bins);
  let core = "";
  for (let i = 0; i < 9; i += 1) core += String(randomInt(0, 9));
  const digits = `${prefix}${core}`;
  return `${digits}${luhnChecksum(digits)}`;
}

function generateUnifiedCreditCode(): string {
  const org = pick(["911100", "913100", "914403", "915001", "913301", "914201", "916101", "915001", "913201", "913502"]);
  const body = `${randomInt(10000000, 99999999)}${pick(["M", "N", "P", "Q", "R", "T", "X", "Y"])}`;
  const chars = `${org}${body}`;
  const weights = "0123456789ABCDEFGHJKLMNPQRTUWXY".split("").reduce((acc, c, i) => ({ ...acc, [c]: i }), {} as Record<string, number>);
  const w = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    const idx = weights[chars[i].toUpperCase()] ?? 0;
    sum += idx * w[i];
  }
  const check = (31 - (sum % 31)) % 31;
  const checkChar = "0123456789ABCDEFGHJKLMNPQRTUWXY"[check];
  return `${chars}${checkChar}`;
}

function generateAddress(): string {
  return `${pick(CITIES)}${pick(DISTRICTS)}${pick(ROADS)}${randomInt(1, 999)}号${randomInt(1, 20)}栋${randomInt(101, 2501)}室`;
}

function generateCompany(): string {
  const prefix = pick(COMPANY_PREFIXES);
  const word = pick(COMPANY_WORDS);
  const suffix = pick(COMPANY_SUFFIXES);
  const city = pick(CITIES).replace("市", "");
  return `${city}${prefix}${word}${suffix}`;
}

function generateCoordinates(): { longitude: number; latitude: number } {
  return {
    longitude: Number((73 + Math.random() * 53).toFixed(6)),
    latitude: Number((3 + Math.random() * 50).toFixed(6)),
  };
}

/* ── Random data ─────────────────────────────────────────────── */

function generateMac(): string {
  const hex = "0123456789ABCDEF".split("");
  const parts: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    parts.push(`${pick(hex)}${pick(hex)}`);
  }
  return parts.join(":");
}

function generateIp(): string {
  return `${randomInt(1, 223)}.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 254)}`;
}

function generateColor(): string {
  return `#${randomBytes(3).toString("hex").toUpperCase()}`;
}

function randomString(length: number, pool: string): string {
  let result = "";
  for (let i = 0; i < length; i += 1) result += pool[Math.floor(Math.random() * pool.length)];
  return result;
}

function generatePassword(length: number, options?: { uppercase?: boolean; lowercase?: boolean; digits?: boolean; symbols?: boolean }): string {
  const opts = { uppercase: true, lowercase: true, digits: true, symbols: true, ...options };
  const pools: string[] = [];
  if (opts.uppercase) pools.push("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  if (opts.lowercase) pools.push("abcdefghijklmnopqrstuvwxyz");
  if (opts.digits) pools.push("0123456789");
  if (opts.symbols) pools.push("!@#$%^&*()_+-=[]{}|;:,.<>?");
  const pool = pools.join("") || "abcdefghijklmnopqrstuvwxyz";
  let pwd = randomString(length, pool);
  // Ensure at least one char from each selected pool
  let i = 0;
  for (const p of pools) {
    pwd = pwd.slice(0, i) + pick(p.split("")) + pwd.slice(i + 1);
    i += 1;
  }
  return shuffle(pwd.split("")).join("");
}

function randomDate(start?: string, end?: string): string {
  const s = start ? new Date(start).getTime() : Date.now() - 365 * 24 * 60 * 60 * 1000;
  const e = end ? new Date(end).getTime() : Date.now();
  const ts = randomInt(Math.min(s, e), Math.max(s, e));
  return new Date(ts).toISOString();
}

/* ── String tools ────────────────────────────────────────────── */

function escapeString(str: string): string {
  return JSON.stringify(str).slice(1, -1);
}

function wordCount(str: string): number {
  const cjk = (str.match(/[\u4e00-\u9fa5]/g) || []).length;
  const words = str.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(cjk, words);
}

function regexTest(pattern: string, flags: string, text: string): JsonObject {
  try {
    const re = new RegExp(pattern, flags);
    const matches = text.match(re);
    const groups: JsonObject = {};
    const exec = re.exec(text);
    if (exec?.groups) Object.assign(groups, exec.groups);
    return {
      matched: matches !== null,
      matches: matches ?? [],
      groups,
      error: null,
    };
  } catch (error) {
    return {
      matched: false,
      matches: [],
      groups: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function textDiff(a: string, b: string): JsonValue[] {
  const la = a.split("\n");
  const lb = b.split("\n");
  const result: JsonValue[] = [];
  let i = 0;
  let j = 0;
  while (i < la.length || j < lb.length) {
    if (i >= la.length) {
      result.push({ type: "added", line: lb[j], index: j + 1 });
      j += 1;
    } else if (j >= lb.length) {
      result.push({ type: "removed", line: la[i], index: i + 1 });
      i += 1;
    } else if (la[i] === lb[j]) {
      result.push({ type: "same", line: la[i], index: i + 1 });
      i += 1;
      j += 1;
    } else {
      result.push({ type: "removed", line: la[i], index: i + 1 });
      result.push({ type: "added", line: lb[j], index: j + 1 });
      i += 1;
      j += 1;
    }
  }
  return result;
}

/* ── Encoding tools ──────────────────────────────────────────── */

function unicodeEscape(str: string): string {
  return str.replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function unicodeUnescape(str: string): string {
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
}

function asciiToCharCodes(str: string): string {
  return Array.from(str).map((c) => c.charCodeAt(0)).join(" ");
}

function charCodesToAscii(str: string): string {
  return str
    .split(/\s+/)
    .filter(Boolean)
    .map((c) => String.fromCharCode(Number(c)))
    .join("");
}

function timestampConvert(ts: string, to: string): JsonObject {
  let date: Date;
  if (ts.trim() === "") date = new Date();
  else if (/^\d+$/.test(ts)) date = new Date(Number(ts) * (ts.length > 10 ? 1 : 1000));
  else date = new Date(ts);
  if (Number.isNaN(date.getTime())) throw new Error("无法解析时间戳");
  if (to === "seconds") return { result: String(Math.floor(date.getTime() / 1000)), iso: date.toISOString() };
  if (to === "milliseconds") return { result: String(date.getTime()), iso: date.toISOString() };
  return { result: date.toISOString(), seconds: String(Math.floor(date.getTime() / 1000)), milliseconds: String(date.getTime()) };
}

function colorConvert(value: string, format: string): JsonObject {
  let r = 0;
  let g = 0;
  let b = 0;
  const hex = value.trim();
  if (hex.startsWith("#")) {
    const clean = hex.slice(1);
    if (clean.length === 3) {
      r = parseInt(clean[0] + clean[0], 16);
      g = parseInt(clean[1] + clean[1], 16);
      b = parseInt(clean[2] + clean[2], 16);
    } else if (clean.length === 6) {
      r = parseInt(clean.slice(0, 2), 16);
      g = parseInt(clean.slice(2, 4), 16);
      b = parseInt(clean.slice(4, 6), 16);
    }
  } else if (hex.startsWith("rgb(")) {
    const m = hex.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (m) {
      r = Number(m[1]);
      g = Number(m[2]);
      b = Number(m[3]);
    }
  }
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) throw new Error("无法解析颜色");
  r = clamp(r, 0, 255);
  g = clamp(g, 0, 255);
  b = clamp(b, 0, 255);
  const toHex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
  const rgb = `rgb(${r}, ${g}, ${b})`;
  const rgba = `rgba(${r}, ${g}, ${b}, 1)`;
  const hexa = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  if (format === "rgb") return { result: rgb, hex: hexa, rgba };
  if (format === "rgba") return { result: rgba, hex: hexa, rgb };
  return { result: hexa, rgb, rgba };
}

function jwtDecode(token: string): JsonObject {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("JWT 格式不正确");
  const decode = (segment: string) => {
    const padded = segment + "=".repeat((4 - (segment.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64url").toString("utf8"));
  };
  return { header: decode(parts[0]), payload: decode(parts[1]) };
}

/* ── JSON tools ──────────────────────────────────────────────── */

import { XMLParser, XMLBuilder } from "fast-xml-parser";

function jsonFormat(input: string): JsonObject {
  const parsed = JSON.parse(input);
  return { result: JSON.stringify(parsed, null, 2), compact: JSON.stringify(parsed) };
}

function jsonValidate(input: string): JsonObject {
  try {
    JSON.parse(input);
    return { valid: true, error: null };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function jsonToXml(input: string, rootName = "root"): string {
  const parsed = JSON.parse(input);
  const builder = new XMLBuilder({ format: true, ignoreAttributes: false });
  return builder.build({ [rootName]: parsed });
}

function xmlToJson(input: string): JsonValue {
  const parser = new XMLParser({ ignoreAttributes: false, parseAttributeValue: true });
  return parser.parse(input);
}

function jsonToYaml(input: string): string {
  const parsed = JSON.parse(input);
  return objectToYaml(parsed);
}

function yamlToJson(input: string): JsonValue {
  // Minimal YAML parser for simple structures
  const lines = input.split("\n");
  const { value } = parseYamlValue(lines, 0, -1);
  return value;
}

function objectToYaml(value: JsonValue, indent = 0): string {
  const padStr = "  ".repeat(indent);
  if (value === null) return "null";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (/[:\[\]{}#&*!|>'"%@`,\n]/.test(value) || value.startsWith(" ") || value.endsWith(" ")) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value.map((item) => `${padStr}- ${objectToYaml(item, indent + 1).trimStart()}`).join("\n");
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";
  return entries.map(([k, v]) => {
    const child = objectToYaml(v, indent + 1);
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      return `${padStr}${k}:\n${child}`;
    }
    if (Array.isArray(v)) {
      return `${padStr}${k}:\n${child}`;
    }
    return `${padStr}${k}: ${child}`;
  }).join("\n");
}

function parseYamlValue(lines: string[], start: number, baseIndent: number): { value: JsonValue; end: number } {
  if (start >= lines.length) return { value: null, end: start };
  const line = lines[start];
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return parseYamlValue(lines, start + 1, baseIndent);
  const indent = line.search(/\S/);

  if (trimmed === "[]") return { value: [], end: start + 1 };
  if (trimmed === "{}") return { value: {}, end: start + 1 };
  if (trimmed.startsWith("- ")) {
    const arr: JsonValue[] = [];
    let i = start;
    while (i < lines.length) {
      const l = lines[i];
      const t = l.trim();
      if (t === "" || t.startsWith("#")) { i += 1; continue; }
      if (!l.trimStart().startsWith("-")) break;
      const itemLine = l.replace(/^\s*-\s*/, "");
      if (itemLine === "") {
        const { value, end } = parseYamlValue(lines, i + 1, indent + 2);
        arr.push(value);
        i = end;
      } else {
        const inline = parseYamlScalar(itemLine);
        if (typeof inline === "string" && i + 1 < lines.length && lines[i + 1].search(/\S/) > indent) {
          const { value, end } = parseYamlValue(lines, i + 1, indent + 2);
          arr.push(value);
          i = end;
        } else {
          arr.push(inline);
          i += 1;
        }
      }
    }
    return { value: arr, end: i };
  }

  if (trimmed.includes(": ") || trimmed.endsWith(":")) {
    const obj: JsonObject = {};
    let i = start;
    while (i < lines.length) {
      const l = lines[i];
      const t = l.trim();
      if (t === "" || t.startsWith("#")) { i += 1; continue; }
      const idx = l.search(/\S/);
      if (idx < indent && i > start) break;
      if (idx > indent) { i += 1; continue; }
      const colon = t.indexOf(":");
      if (colon < 0) break;
      const key = t.slice(0, colon).trim();
      const rest = t.slice(colon + 1).trim();
      if (rest === "") {
        const { value, end } = parseYamlValue(lines, i + 1, indent + 2);
        obj[key] = value;
        i = end;
      } else {
        obj[key] = parseYamlScalar(rest);
        i += 1;
      }
    }
    return { value: obj, end: i };
  }

  return { value: parseYamlScalar(trimmed), end: start + 1 };
}

function parseYamlScalar(raw: string): JsonValue {
  const v = raw.trim();
  if (v === "null" || v === "~") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^"(.*)"$/.test(v)) return v.slice(1, -1).replace(/\\"/g, '"');
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d+\.\d+$/.test(v)) return Number(v);
  return v;
}

function jsonFlatten(input: string, delimiter = "."): JsonObject {
  const parsed = JSON.parse(input);
  const result: JsonObject = {};
  function walk(value: JsonValue, path: string) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) {
        walk(v, path ? `${path}${delimiter}${k}` : k);
      }
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}${delimiter}${i}`));
    } else {
      result[path] = value;
    }
  }
  walk(parsed, "");
  return result;
}

/* ── Crypto tools ────────────────────────────────────────────── */

function aesEncrypt(plain: string, password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const payload = Buffer.concat([salt, iv, encrypted]);
  return payload.toString("base64");
}

function aesDecrypt(cipherText: string, password: string): string {
  const buf = Buffer.from(cipherText, "base64");
  if (buf.length < 48) throw new Error("密文格式不正确");
  const salt = buf.subarray(0, 16);
  const iv = buf.subarray(16, 32);
  const encrypted = buf.subarray(32);
  const key = scryptSync(password, salt, 32);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

function passwordStrength(password: string): JsonObject {
  let score = 0;
  const checks = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    digits: /\d/.test(password),
    symbols: /[^A-Za-z0-9]/.test(password),
  };
  score += password.length >= 8 ? 1 : 0;
  score += password.length >= 12 ? 1 : 0;
  score += checks.uppercase ? 1 : 0;
  score += checks.lowercase ? 1 : 0;
  score += checks.digits ? 1 : 0;
  score += checks.symbols ? 1 : 0;
  let level = "弱";
  if (score >= 6) level = "极强";
  else if (score >= 5) level = "强";
  else if (score >= 3) level = "中";
  return { score, level, checks, length: password.length };
}

function generateSalt(length = 16): string {
  return randomBytes(length).toString("hex");
}

/* ── Crontab tools ───────────────────────────────────────────── */

const CRON_FIELDS = ["minute", "hour", "dayOfMonth", "month", "dayOfWeek"];

function parseCronField(field: string, min: number, max: number): number[] {
  if (field === "*") {
    const vals: number[] = [];
    for (let i = min; i <= max; i += 1) vals.push(i);
    return vals;
  }
  if (field === "?") return [];
  const result = new Set<number>();
  for (const part of field.split(",")) {
    if (part.includes("/")) {
      const [range, step] = part.split("/");
      const s = Number(step);
      const [a, b] = range === "*" ? [min, max] : range.split("-").map(Number);
      for (let i = a; i <= b; i += s) result.add(i);
    } else if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number);
      for (let i = a; i <= b; i += 1) result.add(i);
    } else {
      result.add(Number(part));
    }
  }
  return [...result].sort((a, b) => a - b);
}

function cronDescription(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) return "表达式格式不正确";
  const offsets = parts.length === 6 ? [0, 1, 2, 3, 4, 5] : [-1, 0, 1, 2, 3, 4];
  const labels = ["秒", "分", "时", "日", "月", "周"];
  return parts
    .map((p, i) => `${labels[offsets[i] + 1]}: ${p}`)
    .join("，");
}

function cronNextRuns(expression: string, count = 5): string[] {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) throw new Error("仅支持 5 或 6 字段 Cron 表达式");
  const hasSeconds = parts.length === 6;
  const ranges = [
    hasSeconds ? [0, 59] : null,
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6],
  ].filter(Boolean) as [number, number][];
  const parsed = parts.map((p, i) => parseCronField(p, ranges[i][0], ranges[i][1]));
  const result: string[] = [];
  let cursor = new Date();
  cursor.setMilliseconds(0);
  if (!hasSeconds) cursor.setSeconds(0);

  const matches = (d: Date) => {
    const checks = [
      hasSeconds ? parsed[0].includes(d.getSeconds()) : true,
      parsed[hasSeconds ? 1 : 0].includes(d.getMinutes()),
      parsed[hasSeconds ? 2 : 1].includes(d.getHours()),
      parsed[hasSeconds ? 3 : 2].includes(d.getDate()),
      parsed[hasSeconds ? 4 : 3].includes(d.getMonth() + 1),
      parsed[hasSeconds ? 5 : 4].includes(d.getDay()),
    ];
    return checks.every(Boolean);
  };

  const stepMs = hasSeconds ? 1000 : 60 * 1000;
  while (result.length < count) {
    cursor = new Date(cursor.getTime() + stepMs);
    if (matches(cursor)) {
      result.push(cursor.toISOString());
    }
    // Safety bound: stop if searching too far
    if (cursor.getTime() - Date.now() > 366 * 24 * 60 * 60 * 1000) break;
  }
  return result;
}

/* ── Tool registry ───────────────────────────────────────────── */

export const tools: ToolDefinition[] = [
  /* ── Test data ─────────────────────────────────────────────── */
  {
    id: "chinese_name",
    name: "中文姓名",
    description: "随机生成中文姓名，可指定性别",
    category: "test_data",
    params: [
      { name: "gender", label: "性别", type: "select", default: "random", options: [{ label: "随机", value: "random" }, { label: "男", value: "male" }, { label: "女", value: "female" }] },
    ],
    execute: (args) => generateChineseName(text(args.gender)),
  },
  {
    id: "phone",
    name: "手机号",
    description: "生成中国大陆手机号",
    category: "test_data",
    params: [],
    execute: () => generatePhone(),
  },
  {
    id: "email",
    name: "邮箱",
    description: "生成随机邮箱地址",
    category: "test_data",
    params: [{ name: "name", label: "用户名", type: "text", placeholder: "留空则随机生成" }],
    execute: (args) => generateEmail(text(args.name)),
  },
  {
    id: "id_card",
    name: "身份证",
    description: "生成中国大陆 18 位身份证号码",
    category: "test_data",
    params: [{ name: "birth", label: "出生日期", type: "text", placeholder: "YYYYMMDD，留空随机" }],
    execute: (args) => generateIdCard(text(args.birth)),
  },
  {
    id: "address",
    name: "地址",
    description: "生成随机中文地址",
    category: "test_data",
    params: [],
    execute: () => generateAddress(),
  },
  {
    id: "bank_card",
    name: "银行卡号",
    description: "生成带校验位的银联借记卡号",
    category: "test_data",
    params: [],
    execute: () => generateBankCard(),
  },
  {
    id: "company",
    name: "公司名称",
    description: "生成随机公司名称",
    category: "test_data",
    params: [],
    execute: () => generateCompany(),
  },
  {
    id: "credit_code",
    name: "统一社会信用代码",
    description: "生成 18 位统一社会信用代码",
    category: "test_data",
    params: [],
    execute: () => generateUnifiedCreditCode(),
  },
  {
    id: "coordinates",
    name: "经纬度",
    description: "生成中国大陆范围内的经纬度",
    category: "test_data",
    params: [],
    execute: () => generateCoordinates(),
  },
  {
    id: "user_profile",
    name: "用户档案",
    description: "生成完整用户档案",
    category: "test_data",
    params: [],
    execute: () => {
      const name = generateChineseName();
      return {
        name,
        phone: generatePhone(),
        email: generateEmail(name),
        idCard: generateIdCard(),
        address: generateAddress(),
        company: generateCompany(),
        bankCard: generateBankCard(),
        coordinates: generateCoordinates(),
      };
    },
  },

  /* ── Random data ───────────────────────────────────────────── */
  {
    id: "random_integer",
    name: "随机整数",
    description: "生成指定范围内的随机整数",
    category: "random",
    params: [
      { name: "min", label: "最小值", type: "number", default: 1 },
      { name: "max", label: "最大值", type: "number", default: 100 },
    ],
    execute: (args) => randomInt(num(args.min, 1), num(args.max, 100)),
  },
  {
    id: "random_float",
    name: "随机浮点数",
    description: "生成指定范围内的随机浮点数",
    category: "random",
    params: [
      { name: "min", label: "最小值", type: "number", default: 0 },
      { name: "max", label: "最大值", type: "number", default: 1 },
      { name: "decimals", label: "小数位", type: "number", default: 2 },
    ],
    execute: (args) => {
      const min = num(args.min, 0);
      const max = num(args.max, 1);
      const decimals = clamp(num(args.decimals, 2), 0, 10);
      const value = Math.random() * (max - min) + min;
      return Number(value.toFixed(decimals));
    },
  },
  {
    id: "random_string",
    name: "随机字符串",
    description: "按字符池生成随机字符串",
    category: "random",
    params: [
      { name: "length", label: "长度", type: "number", default: 16 },
      { name: "pool", label: "字符池", type: "select", default: "alphanumeric", options: [{ label: "字母数字", value: "alphanumeric" }, { label: "数字", value: "digits" }, { label: "字母", value: "letters" }, { label: "十六进制", value: "hex" }] },
    ],
    execute: (args) => {
      const len = clamp(num(args.length, 16), 1, 4096);
      const pools: Record<string, string> = {
        alphanumeric: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
        digits: "0123456789",
        letters: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
        hex: "0123456789abcdef",
      };
      return randomString(len, pools[text(args.pool)] ?? pools.alphanumeric);
    },
  },
  {
    id: "uuid",
    name: "UUID",
    description: "生成 UUID v4",
    category: "random",
    params: [],
    execute: () => randomUUID(),
  },
  {
    id: "mac_address",
    name: "MAC 地址",
    description: "生成随机 MAC 地址",
    category: "random",
    params: [],
    execute: () => generateMac(),
  },
  {
    id: "ip_address",
    name: "IP 地址",
    description: "生成随机 IPv4 地址",
    category: "random",
    params: [],
    execute: () => generateIp(),
  },
  {
    id: "random_date",
    name: "随机日期",
    description: "生成指定区间内的随机 ISO 日期",
    category: "random",
    params: [
      { name: "start", label: "开始日期", type: "text", placeholder: "YYYY-MM-DD，留空为一年前" },
      { name: "end", label: "结束日期", type: "text", placeholder: "YYYY-MM-DD，留空为现在" },
    ],
    execute: (args) => randomDate(text(args.start), text(args.end)),
  },
  {
    id: "random_color",
    name: "随机颜色",
    description: "生成随机十六进制颜色",
    category: "random",
    params: [],
    execute: () => generateColor(),
  },
  {
    id: "random_password",
    name: "随机密码",
    description: "生成强密码",
    category: "random",
    params: [
      { name: "length", label: "长度", type: "number", default: 16 },
      { name: "uppercase", label: "包含大写", type: "boolean", default: true },
      { name: "lowercase", label: "包含小写", type: "boolean", default: true },
      { name: "digits", label: "包含数字", type: "boolean", default: true },
      { name: "symbols", label: "包含符号", type: "boolean", default: true },
    ],
    execute: (args) => generatePassword(clamp(num(args.length, 16), 4, 128), {
      uppercase: bool(args.uppercase),
      lowercase: bool(args.lowercase),
      digits: bool(args.digits),
      symbols: bool(args.symbols),
    }),
  },

  /* ── String tools ──────────────────────────────────────────── */
  {
    id: "trim",
    name: "去空白",
    description: "去除首尾空白及多余空行",
    category: "string",
    params: [{ name: "text", label: "文本", type: "textarea", required: true }],
    execute: (args) => text(args.text).replace(/^\s+|\s+$/g, "").replace(/\n{3,}/g, "\n\n"),
  },
  {
    id: "replace",
    name: "文本替换",
    description: "普通文本替换，支持正则",
    category: "string",
    params: [
      { name: "text", label: "文本", type: "textarea", required: true },
      { name: "search", label: "查找", type: "text", required: true },
      { name: "replacement", label: "替换为", type: "text", default: "" },
      { name: "regex", label: "使用正则", type: "boolean", default: false },
      { name: "global", label: "全局替换", type: "boolean", default: true },
    ],
    execute: (args) => {
      const t = text(args.text);
      const s = text(args.search);
      const r = text(args.replacement);
      if (bool(args.regex)) {
        const flags = bool(args.global) ? "g" : "";
        return t.replace(new RegExp(s, flags), r);
      }
      return bool(args.global) ? t.split(s).join(r) : t.replace(s, r);
    },
  },
  {
    id: "escape",
    name: "转义字符串",
    description: "将文本转义为 JavaScript 字符串字面量",
    category: "string",
    params: [{ name: "text", label: "文本", type: "textarea", required: true }],
    execute: (args) => escapeString(text(args.text)),
  },
  {
    id: "regex_test",
    name: "正则测试",
    description: "测试正则是否匹配并提取分组",
    category: "string",
    params: [
      { name: "text", label: "文本", type: "textarea", required: true },
      { name: "pattern", label: "正则", type: "text", required: true, placeholder: "例如: \\d+" },
      { name: "flags", label: "标志", type: "text", default: "g", placeholder: "g, i, m..." },
    ],
    execute: (args) => regexTest(text(args.pattern), text(args.flags, "g"), text(args.text)),
  },
  {
    id: "case_convert",
    name: "大小写转换",
    description: "转换文本大小写",
    category: "string",
    params: [
      { name: "text", label: "文本", type: "textarea", required: true },
      { name: "case", label: "目标大小写", type: "select", default: "lower", options: [{ label: "小写", value: "lower" }, { label: "大写", value: "upper" }, { label: "首字母大写", value: "capitalize" }, { label: "驼峰", value: "camel" }, { label: "下划线", value: "snake" }] },
    ],
    execute: (args) => {
      const t = text(args.text);
      switch (text(args.case)) {
        case "upper": return t.toUpperCase();
        case "capitalize": return t.replace(/(?:^|[^\p{L}\p{N}])+([\p{L}\p{N}])/gu, (m, c) => m.slice(0, -1) + c.toUpperCase());
        case "camel": return t.toLowerCase().replace(/[^\p{L}\p{N}]+([\p{L}\p{N}])/gu, (_m, c) => c.toUpperCase()).replace(/^([A-Z])/, (c) => c.toLowerCase());
        case "snake": return t.replace(/[\s\-]+/g, "_").replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
        default: return t.toLowerCase();
      }
    },
  },
  {
    id: "word_count",
    name: "字数统计",
    description: "统计字符数、词数、行数",
    category: "string",
    params: [{ name: "text", label: "文本", type: "textarea", required: true }],
    execute: (args) => {
      const t = text(args.text);
      return {
        chars: t.length,
        charsNoSpace: t.replace(/\s/g, "").length,
        words: wordCount(t),
        lines: t.length === 0 ? 0 : t.split("\n").length,
        bytes: Buffer.byteLength(t, "utf8"),
      };
    },
  },
  {
    id: "text_diff",
    name: "文本对比",
    description: "按行对比两段文本差异",
    category: "string",
    params: [
      { name: "old", label: "原文本", type: "textarea", required: true },
      { name: "new", label: "新文本", type: "textarea", required: true },
    ],
    execute: (args) => textDiff(text(args.old), text(args.new)),
  },

  /* ── Encoding tools ────────────────────────────────────────── */
  {
    id: "base64_encode",
    name: "Base64 编码",
    description: "将文本编码为 Base64",
    category: "encoding",
    params: [{ name: "text", label: "文本", type: "textarea", required: true }],
    execute: (args) => Buffer.from(text(args.text), "utf8").toString("base64"),
  },
  {
    id: "base64_decode",
    name: "Base64 解码",
    description: "将 Base64 还原为文本",
    category: "encoding",
    params: [{ name: "text", label: "Base64", type: "textarea", required: true }],
    execute: (args) => Buffer.from(text(args.text), "base64").toString("utf8"),
  },
  {
    id: "url_encode",
    name: "URL 编码",
    description: "URL 编码",
    category: "encoding",
    params: [{ name: "text", label: "文本", type: "textarea", required: true }],
    execute: (args) => encodeURIComponent(text(args.text)),
  },
  {
    id: "url_decode",
    name: "URL 解码",
    description: "URL 解码",
    category: "encoding",
    params: [{ name: "text", label: "URL 编码文本", type: "textarea", required: true }],
    execute: (args) => decodeURIComponent(text(args.text)),
  },
  {
    id: "unicode_escape",
    name: "Unicode 转义",
    description: "将非 ASCII 字符转为 \\uXXXX",
    category: "encoding",
    params: [{ name: "text", label: "文本", type: "textarea", required: true }],
    execute: (args) => unicodeEscape(text(args.text)),
  },
  {
    id: "unicode_unescape",
    name: "Unicode 还原",
    description: "将 \\uXXXX 还原为字符",
    category: "encoding",
    params: [{ name: "text", label: "转义文本", type: "textarea", required: true }],
    execute: (args) => unicodeUnescape(text(args.text)),
  },
  {
    id: "ascii_codes",
    name: "ASCII 码",
    description: "字符与 ASCII 码互转",
    category: "encoding",
    params: [
      { name: "text", label: "文本", type: "textarea", required: true },
      { name: "mode", label: "模式", type: "select", default: "to_codes", options: [{ label: "文本 → ASCII 码", value: "to_codes" }, { label: "ASCII 码 → 文本", value: "to_text" }] },
    ],
    execute: (args) => text(args.mode) === "to_text" ? charCodesToAscii(text(args.text)) : asciiToCharCodes(text(args.text)),
  },
  {
    id: "timestamp",
    name: "时间戳转换",
    description: "时间戳与 ISO 日期互转",
    category: "encoding",
    params: [
      { name: "value", label: "值", type: "text", placeholder: "时间戳或日期，留空为当前时间" },
      { name: "mode", label: "目标格式", type: "select", default: "iso", options: [{ label: "ISO 日期", value: "iso" }, { label: "秒级时间戳", value: "seconds" }, { label: "毫秒级时间戳", value: "milliseconds" }] },
    ],
    execute: (args) => timestampConvert(text(args.value), text(args.mode, "iso")),
  },
  {
    id: "color_convert",
    name: "颜色值转换",
    description: "Hex / RGB / RGBA 互转",
    category: "encoding",
    params: [
      { name: "value", label: "颜色值", type: "text", default: "#2563eb", placeholder: "#2563eb 或 rgb(37, 99, 235)" },
      { name: "format", label: "目标格式", type: "select", default: "hex", options: [{ label: "Hex", value: "hex" }, { label: "RGB", value: "rgb" }, { label: "RGBA", value: "rgba" }] },
    ],
    execute: (args) => colorConvert(text(args.value, "#2563eb"), text(args.format, "hex")),
  },
  {
    id: "jwt_decode",
    name: "JWT 解码",
    description: "解析 JWT 头部与载荷（不验证签名）",
    category: "encoding",
    params: [{ name: "token", label: "JWT Token", type: "textarea", required: true }],
    execute: (args) => jwtDecode(text(args.token)),
  },

  /* ── JSON tools ────────────────────────────────────────────── */
  {
    id: "json_format",
    name: "JSON 格式化",
    description: "美化或压缩 JSON",
    category: "json",
    params: [
      { name: "json", label: "JSON", type: "textarea", required: true },
      { name: "compact", label: "压缩", type: "boolean", default: false },
    ],
    execute: (args) => {
      const parsed = JSON.parse(text(args.json));
      return bool(args.compact) ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2);
    },
  },
  {
    id: "json_validate",
    name: "JSON 校验",
    description: "校验 JSON 格式并定位错误",
    category: "json",
    params: [{ name: "json", label: "JSON", type: "textarea", required: true }],
    execute: (args) => jsonValidate(text(args.json)),
  },
  {
    id: "json_to_xml",
    name: "JSON 转 XML",
    description: "JSON 转 XML",
    category: "json",
    params: [
      { name: "json", label: "JSON", type: "textarea", required: true },
      { name: "root", label: "根节点", type: "text", default: "root" },
    ],
    execute: (args) => jsonToXml(text(args.json), text(args.root, "root")),
  },
  {
    id: "xml_to_json",
    name: "XML 转 JSON",
    description: "XML 转 JSON",
    category: "json",
    params: [{ name: "xml", label: "XML", type: "textarea", required: true }],
    execute: (args) => xmlToJson(text(args.xml)),
  },
  {
    id: "json_to_yaml",
    name: "JSON 转 YAML",
    description: "JSON 转 YAML",
    category: "json",
    params: [{ name: "json", label: "JSON", type: "textarea", required: true }],
    execute: (args) => jsonToYaml(text(args.json)),
  },
  {
    id: "yaml_to_json",
    name: "YAML 转 JSON",
    description: "YAML 转 JSON",
    category: "json",
    params: [{ name: "yaml", label: "YAML", type: "textarea", required: true }],
    execute: (args) => yamlToJson(text(args.yaml)),
  },
  {
    id: "json_flatten",
    name: "JSON 扁平化",
    description: "将嵌套 JSON 扁平化为点分键",
    category: "json",
    params: [
      { name: "json", label: "JSON", type: "textarea", required: true },
      { name: "delimiter", label: "分隔符", type: "text", default: "." },
    ],
    execute: (args) => jsonFlatten(text(args.json), text(args.delimiter, ".")),
  },

  /* ── Crypto tools ──────────────────────────────────────────── */
  {
    id: "md5",
    name: "MD5",
    description: "计算 MD5 哈希",
    category: "crypto",
    params: [{ name: "text", label: "文本", type: "textarea", required: true }],
    execute: (args) => createHash("md5").update(text(args.text)).digest("hex"),
  },
  {
    id: "sha1",
    name: "SHA1",
    description: "计算 SHA1 哈希",
    category: "crypto",
    params: [{ name: "text", label: "文本", type: "textarea", required: true }],
    execute: (args) => createHash("sha1").update(text(args.text)).digest("hex"),
  },
  {
    id: "sha256",
    name: "SHA256",
    description: "计算 SHA256 哈希",
    category: "crypto",
    params: [{ name: "text", label: "文本", type: "textarea", required: true }],
    execute: (args) => createHash("sha256").update(text(args.text)).digest("hex"),
  },
  {
    id: "sha512",
    name: "SHA512",
    description: "计算 SHA512 哈希",
    category: "crypto",
    params: [{ name: "text", label: "文本", type: "textarea", required: true }],
    execute: (args) => createHash("sha512").update(text(args.text)).digest("hex"),
  },
  {
    id: "aes_encrypt",
    name: "AES 加密",
    description: "使用密码 AES-256-CBC 加密",
    category: "crypto",
    params: [
      { name: "text", label: "明文", type: "textarea", required: true },
      { name: "password", label: "密码", type: "text", required: true },
    ],
    execute: (args) => aesEncrypt(text(args.text), text(args.password)),
  },
  {
    id: "aes_decrypt",
    name: "AES 解密",
    description: "使用密码 AES-256-CBC 解密",
    category: "crypto",
    params: [
      { name: "text", label: "密文", type: "textarea", required: true },
      { name: "password", label: "密码", type: "text", required: true },
    ],
    execute: (args) => aesDecrypt(text(args.text), text(args.password)),
  },
  {
    id: "password_strength",
    name: "密码强度",
    description: "评估密码强度",
    category: "crypto",
    params: [{ name: "password", label: "密码", type: "text", required: true }],
    execute: (args) => passwordStrength(text(args.password)),
  },
  {
    id: "salt",
    name: "盐值生成",
    description: "生成随机盐值",
    category: "crypto",
    params: [{ name: "length", label: "长度（字节）", type: "number", default: 16 }],
    execute: (args) => generateSalt(clamp(num(args.length, 16), 1, 128)),
  },

  /* ── Crontab tools ─────────────────────────────────────────── */
  {
    id: "cron_next",
    name: "Cron 下次执行时间",
    description: "计算 Cron 表达式未来执行时间",
    category: "crontab",
    params: [
      { name: "expression", label: "Cron 表达式", type: "text", default: "0 9 * * 1-5", required: true },
      { name: "count", label: "返回条数", type: "number", default: 5 },
    ],
    execute: (args) => ({
      expression: text(args.expression, "0 9 * * 1-5"),
      nextRuns: cronNextRuns(text(args.expression, "0 9 * * 1-5"), clamp(num(args.count, 5), 1, 50)),
    }),
  },
  {
    id: "cron_describe",
    name: "Cron 表达式解析",
    description: "按字段解析 Cron 表达式",
    category: "crontab",
    params: [{ name: "expression", label: "Cron 表达式", type: "text", default: "0 9 * * 1-5", required: true }],
    execute: (args) => ({
      expression: text(args.expression, "0 9 * * 1-5"),
      description: cronDescription(text(args.expression, "0 9 * * 1-5")),
    }),
  },
];

export const categories: ToolCategory[] = [
  { id: "test_data", name: "测试数据", description: "中文姓名、手机号、身份证、银行卡等", icon: "Users", tools: tools.filter((t) => t.category === "test_data").map((t) => t.id) },
  { id: "random", name: "随机数据", description: "UUID、MAC、IP、密码、颜色等", icon: "Shuffle", tools: tools.filter((t) => t.category === "random").map((t) => t.id) },
  { id: "string", name: "字符串", description: "去空白、替换、正则、大小写、字数统计", icon: "Type", tools: tools.filter((t) => t.category === "string").map((t) => t.id) },
  { id: "encoding", name: "编码解码", description: "Base64、URL、Unicode、时间戳、JWT", icon: "Code2", tools: tools.filter((t) => t.category === "encoding").map((t) => t.id) },
  { id: "json", name: "JSON", description: "格式化、校验、XML/YAML 互转、扁平化", icon: "Braces", tools: tools.filter((t) => t.category === "json").map((t) => t.id) },
  { id: "crypto", name: "加密哈希", description: "MD5、SHA、AES、密码强度、盐值", icon: "Lock", tools: tools.filter((t) => t.category === "crypto").map((t) => t.id) },
  { id: "crontab", name: "Crontab", description: "Cron 表达式解析与下次执行时间", icon: "Clock", tools: tools.filter((t) => t.category === "crontab").map((t) => t.id) },
];

export function findTool(id: string): ToolDefinition | undefined {
  return tools.find((t) => t.id === id);
}

export function buildToolResponse(tool: ToolDefinition): JsonObject {
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    category: tool.category,
    icon: tool.icon ?? null,
    params: tool.params as unknown as JsonValue,
  };
}
