// Copying from a panel beside the 网申 page: the page view usually has the
// focus, and navigator.clipboard refuses a document that is not focused
// ("复制失败"). The desktop App writes through Electron's clipboard instead.
export async function copyText(text: string): Promise<void> {
  const bridge = typeof window !== "undefined" ? window.desktopBridge : undefined;
  if (bridge?.copyText) {
    await bridge.copyText(text);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    if (!ok) throw new Error("复制失败");
  }
}
