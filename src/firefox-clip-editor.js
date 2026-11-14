(() => {
  if (location.origin !== "https://chzzk.naver.com" ||
      location.pathname !== "/clip-editor") return;

  const ua = navigator.userAgent;
  if (!/\bGecko\/\d+.*\bFirefox\/\d/.test(ua) || /Mobile|Android/i.test(ua)) return;

  // 공식 편집기의 이름 기반 판정에만 관여하고 실제 기능 검사는 그대로 둔다.
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: ua.replace(/\s+Firefox\/[\d.]+\b/, "")
  });
})();
