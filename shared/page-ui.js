(() => {
  const NOTICE_ID = "shotgpt-tools-notice";

  function showNotice(message, duration = 1600) {
    document.getElementById(NOTICE_ID)?.remove();

    const notice = document.createElement("div");
    notice.id = NOTICE_ID;
    notice.textContent = message;
    notice.setAttribute("role", "status");
    document.body.appendChild(notice);

    requestAnimationFrame(() => notice.classList.add("is-visible"));
    if (duration === 0) return;

    window.setTimeout(() => {
      notice.classList.remove("is-visible");
      window.setTimeout(() => notice.remove(), 180);
    }, duration);
  }

  globalThis.ShotGPTTools = {
    ...(globalThis.ShotGPTTools || {}),
    showNotice
  };
})();
