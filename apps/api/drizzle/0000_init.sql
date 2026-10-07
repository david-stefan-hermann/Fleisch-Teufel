CREATE SEQUENCE "public"."sync_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "ai_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model" text NOT NULL,
	"user_text" text,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_usd" double precision NOT NULL,
	"duration_ms" integer NOT NULL,
	"result" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_foods" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"change_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"barcode" text,
	"unit" text NOT NULL,
	"nutrients" jsonb NOT NULL,
	"portions" jsonb NOT NULL,
	CONSTRAINT "custom_foods_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "day_notes" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"change_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"date" date NOT NULL,
	"note" text NOT NULL,
	"completed_at" bigint,
	CONSTRAINT "day_notes_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "exercise_entries" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"change_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"date" date NOT NULL,
	"type_key" text NOT NULL,
	"name" text NOT NULL,
	"minutes" double precision NOT NULL,
	"intensity" text NOT NULL,
	"met" double precision NOT NULL,
	"weight_kg" double precision NOT NULL,
	"kcal" double precision NOT NULL,
	"logged_at" bigint NOT NULL,
	CONSTRAINT "exercise_entries_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "exercise_types" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"change_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"name" text NOT NULL,
	"met" double precision NOT NULL,
	CONSTRAINT "exercise_types_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "food_entries" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"change_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"date" date NOT NULL,
	"meal" integer NOT NULL,
	"logged_at" bigint NOT NULL,
	"food_id" text,
	"source" text NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"grams" double precision,
	"portion_label" text,
	"portion_grams" double precision,
	"quantity" double precision NOT NULL,
	"per100" jsonb,
	"nutrients" jsonb NOT NULL,
	"meal_id" text,
	"ai_analysis_id" text,
	CONSTRAINT "food_entries_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "food_portions" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"change_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"food_id" text NOT NULL,
	"label" text NOT NULL,
	"grams" double precision NOT NULL,
	CONSTRAINT "food_portions_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "foods" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"brand" text,
	"group" text,
	"unit" text NOT NULL,
	"nutrients" jsonb NOT NULL,
	"portions" jsonb NOT NULL,
	"image_url" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"change_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"valid_from" date NOT NULL,
	"days" jsonb NOT NULL,
	"micros" jsonb NOT NULL,
	CONSTRAINT "goals_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "meals" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"change_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"name" text NOT NULL,
	"items" jsonb NOT NULL,
	CONSTRAINT "meals_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "off_misses" (
	"ean" text PRIMARY KEY NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"change_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"sex" text,
	"birth_date" date,
	"height_cm" double precision,
	"activity_level" text NOT NULL,
	"target_weight_kg" double precision,
	"weekly_rate_kg" double precision NOT NULL,
	"meal_names" jsonb NOT NULL,
	"add_exercise_calories" boolean NOT NULL,
	"onboarded_at" bigint,
	CONSTRAINT "user_settings_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "weight_entries" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"change_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"date" date NOT NULL,
	"kg" double precision NOT NULL,
	CONSTRAINT "weight_entries_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_foods" ADD CONSTRAINT "custom_foods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_notes" ADD CONSTRAINT "day_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_entries" ADD CONSTRAINT "exercise_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_types" ADD CONSTRAINT "exercise_types_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_entries" ADD CONSTRAINT "food_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_portions" ADD CONSTRAINT "food_portions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meals" ADD CONSTRAINT "meals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_entries" ADD CONSTRAINT "weight_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_analyses_user_id_created_at_index" ON "ai_analyses" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "custom_foods_user_id_change_seq_index" ON "custom_foods" USING btree ("user_id","change_seq");--> statement-breakpoint
CREATE INDEX "day_notes_user_id_change_seq_index" ON "day_notes" USING btree ("user_id","change_seq");--> statement-breakpoint
CREATE INDEX "exercise_entries_user_id_change_seq_index" ON "exercise_entries" USING btree ("user_id","change_seq");--> statement-breakpoint
CREATE INDEX "exercise_entries_user_id_date_index" ON "exercise_entries" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "exercise_types_user_id_change_seq_index" ON "exercise_types" USING btree ("user_id","change_seq");--> statement-breakpoint
CREATE INDEX "food_entries_user_id_change_seq_index" ON "food_entries" USING btree ("user_id","change_seq");--> statement-breakpoint
CREATE INDEX "food_entries_user_id_date_index" ON "food_entries" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "food_portions_user_id_change_seq_index" ON "food_portions" USING btree ("user_id","change_seq");--> statement-breakpoint
CREATE INDEX "foods_source_source_id_index" ON "foods" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "goals_user_id_change_seq_index" ON "goals" USING btree ("user_id","change_seq");--> statement-breakpoint
CREATE INDEX "meals_user_id_change_seq_index" ON "meals" USING btree ("user_id","change_seq");--> statement-breakpoint
CREATE INDEX "sessions_user_id_index" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_settings_user_id_change_seq_index" ON "user_settings" USING btree ("user_id","change_seq");--> statement-breakpoint
CREATE INDEX "weight_entries_user_id_change_seq_index" ON "weight_entries" USING btree ("user_id","change_seq");