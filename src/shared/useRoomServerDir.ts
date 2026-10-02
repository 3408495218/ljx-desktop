import { useCallback, useEffect, useState } from "react";
import { resolveServerDir } from "@/shared/tauri";
import { useServerProcStore } from "@/stores/serverProc";

/**
 * 房间服务端工作目录：由控制台配置的 jar / 工作目录解析而来。
 * 快照、server.properties 编辑与危险区操作都依赖它，未配置时给出引导文案。
 */
export function useRoomServerDir() {
  const jarPath = useServerProcStore((s) => s.config.jarPath);
  const workDir = useServerProcStore((s) => s.config.workDir);
  const [dir, setDir] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!jarPath.trim() && !workDir.trim()) {
      setDir(null);
      setError("尚未配置服务端：请先在「控制台」选择 Java 运行时并填写核心 jar 路径");
      return;
    }
    try {
      setDir(await resolveServerDir(jarPath, workDir));
      setError(null);
    } catch (e) {
      setDir(null);
      setError(String(e));
    }
  }, [jarPath, workDir]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { dir, error, refresh };
}
