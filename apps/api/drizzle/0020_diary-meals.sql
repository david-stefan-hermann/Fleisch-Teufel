CREATE TABLE "diary_meals" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"change_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"eaten_at" bigint NOT NULL,
	"slot" integer NOT NULL,
	"time_edited" boolean DEFAULT false NOT NULL,
	CONSTRAINT "diary_meals_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "food_entries" ADD COLUMN "diary_meal_id" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "custom_meal_names" jsonb;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "legacy_meal_names" jsonb;--> statement-breakpoint
ALTER TABLE "diary_meals" ADD CONSTRAINT "diary_meals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diary_meals_user_id_change_seq_index" ON "diary_meals" USING btree ("user_id","change_seq");--> statement-breakpoint
CREATE INDEX "diary_meals_user_id_date_index" ON "diary_meals" USING btree ("user_id","date");