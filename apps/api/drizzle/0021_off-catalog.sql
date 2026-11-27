CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "off_catalog" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"unit" text NOT NULL,
	"nutrients" jsonb NOT NULL,
	"portions" jsonb NOT NULL,
	"image_url" text,
	"popularity" integer DEFAULT 0 NOT NULL,
	"german" boolean NOT NULL,
	"search_key" text NOT NULL,
	"run" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "off_catalog_search_key_index" ON "off_catalog" USING gin ("search_key" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "off_catalog_run_index" ON "off_catalog" USING btree ("run");