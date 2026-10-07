CREATE TABLE "exercise_templates" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"change_seq" bigint DEFAULT nextval('sync_seq') NOT NULL,
	"name" text NOT NULL,
	"type_key" text NOT NULL,
	"type_name" text NOT NULL,
	"minutes" double precision NOT NULL,
	"intensity" text NOT NULL,
	"note" text,
	CONSTRAINT "exercise_templates_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "exercise_entries" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "food_entries" ADD COLUMN "group_id" text;--> statement-breakpoint
ALTER TABLE "exercise_templates" ADD CONSTRAINT "exercise_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exercise_templates_user_id_change_seq_index" ON "exercise_templates" USING btree ("user_id","change_seq");