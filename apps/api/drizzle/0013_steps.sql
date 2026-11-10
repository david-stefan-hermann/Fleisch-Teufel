CREATE TABLE "api_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "exercise_entries" ADD COLUMN "steps" integer;--> statement-breakpoint
ALTER TABLE "exercise_entries" ADD COLUMN "distance_m" double precision;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "steps_minimum" integer;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "add_steps_calories" boolean;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_user_id_kind_index" ON "api_tokens" USING btree ("user_id","kind");