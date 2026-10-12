import type { Language } from "./language.js";

const english: Readonly<Record<string, string>> = {
  "账号或密码不正确。": "The username or password is incorrect.",
  "账号状态已改变，请重新登录。": "The account has changed. Sign in again.",
  "登录已失效，请重新登录": "Your session has expired. Sign in again.",
  当前密码不正确: "The current password is incorrect.",
  "请设置与当前密码不同的 6–72 位新密码，不能使用演示密码。":
    "Choose a different password of 6–72 characters. The fixed demo password is not allowed.",
  "账号凭据已改变，请重新登录后再试。":
    "The account credentials changed. Sign in again before retrying.",
  角色不正确: "Choose a valid account role.",
  请输入账号: "Enter your username.",
  请输入密码: "Enter your password.",
  请输入当前密码: "Enter your current password.",
  "新密码至少 6 位": "The new password must contain at least 6 characters.",
  新密码过长: "The new password must contain at most 72 characters.",
  两次输入的新密码不一致: "The two new passwords do not match.",
  请求格式不正确: "The request format is invalid.",
};

export function authMessage(message: string, language: Language): string {
  if (language === "zh") return message;
  const limit = /^尝试次数过多，请 (\d+) 秒后再试。$/.exec(message);
  if (limit) return `Too many attempts. Try again in ${limit[1]} seconds.`;
  return message
    .split("；")
    .map((part) => english[part] ?? part)
    .join(" ");
}
