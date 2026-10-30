declare module "express-mysql-session" {
  import type * as session from "express-session";

  class MySQLStore extends session.Store {
    constructor(options?: Record<string, unknown>, connection?: object | null, callback?: (err?: Error) => void);
  }

  // 参数宽松化：运行时传入 express-session 模块对象，类型上不强绑其 ESM/CJS 形状
  function factory(sessionModule: unknown): typeof MySQLStore;
  export = factory;
}
