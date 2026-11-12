ALTER TABLE "ai_analyses" ADD COLUMN "status" text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD COLUMN "response" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_analyses_user_id_request_id_index" ON "ai_analyses" USING btree ("user_id","request_id") WHERE status = 'ok' and request_id is not null;