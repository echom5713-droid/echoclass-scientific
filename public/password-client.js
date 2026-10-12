const form = document.getElementById("password-change-form");
if (form) {
  const chinese = document.documentElement.lang.startsWith("zh");
  const feedback = document.getElementById("password-feedback");
  const button = form.querySelector('button[type="submit"]');
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = Object.fromEntries(new FormData(form).entries());
    if (input.newPassword !== input.confirmPassword) {
      feedback.textContent = chinese
        ? "两次输入的新密码不一致。"
        : "The two new passwords do not match.";
      document.getElementById("confirm-password").focus();
      return;
    }
    button.disabled = true;
    feedback.textContent = chinese ? "正在保存新密码…" : "Saving your password…";
    try {
      const response = await fetch(form.action, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok) {
        feedback.textContent =
          result.error?.message ||
          (chinese
            ? "修改失败，请重试。"
            : "Your password could not be changed. Please try again.");
        return;
      }
      if (!["/student/login", "/teacher/login", "/admin/login"].includes(result.login_url))
        throw new Error("Invalid sign-in destination");
      form.reset();
      window.location.assign(result.login_url + "?password=changed");
    } catch {
      feedback.textContent = chinese
        ? "暂时无法确认结果。再次提交前，请先尝试使用新密码登录。"
        : "The result could not be confirmed. Try signing in with your new password before submitting again.";
    } finally {
      button.disabled = false;
    }
  });
}
