export class ExtensionReloadRequired extends Error {
  constructor() {
    super(
      "扩展已更新或当前页面与扩展的连接已失效。请先保存正在编辑的内容，刷新此 Overleaf 页面，再重新发送 @bot 指令。已有项目会话和已保存的审阅记录会保留。"
    );
    this.name = "ExtensionReloadRequired";
  }
}
export function requireExtensionContext() {
  if (
    typeof chrome === "undefined" ||
    !chrome.runtime?.id ||
    !chrome.storage?.local
  )
    throw new ExtensionReloadRequired();
}
export function extensionError(error: unknown): Error {
  if (error instanceof ExtensionReloadRequired) return error;
  if (/extension context invalidated/i.test(String(error)))
    return new ExtensionReloadRequired();
  try {
    requireExtensionContext();
  } catch {
    return new ExtensionReloadRequired();
  }
  return error instanceof Error ? error : new Error(String(error));
}
// Test at the moment of each operation: Chrome can invalidate a tab between awaits.
export async function withExtensionContext<T>(
  operation: () => Promise<T>
): Promise<T> {
  requireExtensionContext();
  try {
    return await operation();
  } catch (error) {
    throw extensionError(error);
  }
}
