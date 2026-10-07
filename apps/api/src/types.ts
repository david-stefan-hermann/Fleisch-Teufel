import type { Db } from './db/client.js';
import type { Env } from './env.js';
import type { FoodCatalog } from './foods/catalog.js';
import type { OffClient } from './off/client.js';
import type { FoodAnalyzer } from './ai/analyze.js';

export interface SessionUser {
  id: string;
  email: string;
  createdAt: Date;
  sessionId: string;
}

export interface Deps {
  db: Db;
  env: Env;
  catalog: FoodCatalog;
  off: OffClient;
  analyzer: FoodAnalyzer | null;
  version: string;
}

export type AppEnv = {
  Variables: {
    user: SessionUser;
  };
};
