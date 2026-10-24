import type { Db } from './db/client.js';
import type { Env } from './env.js';
import type { FoodCatalog } from './foods/catalog.js';
import type { OffClient } from './off/client.js';
import type { FoodAnalyzer } from './ai/analyze.js';
import type { PushSender } from './push.js';

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
  /** Web Push for the daily reminder; null without VAPID keys (the feature is then not offered). */
  push: PushSender | null;
  version: string;
}

export type AppEnv = {
  Variables: {
    user: SessionUser;
  };
};
