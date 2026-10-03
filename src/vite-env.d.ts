/// <reference types="vite/client" />

/** 构建期可覆盖的环境变量（见 stores/preferences.ts） */
interface ImportMetaEnv {
  /** 打包发行版时注入的平台后端默认地址，如 `123.108.110.52:49858`；缺省 `127.0.0.1` */
  readonly VITE_DEFAULT_SERVER_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
