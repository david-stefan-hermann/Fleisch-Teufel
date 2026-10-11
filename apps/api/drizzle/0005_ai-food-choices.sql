CREATE TABLE "ai_food_choices" (
	"user_id" uuid NOT NULL,
	"term" text NOT NULL,
	"food_id" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_food_choices_user_id_term_food_id_pk" PRIMARY KEY("user_id","term","food_id")
);
--> statement-breakpoint
ALTER TABLE "ai_food_choices" ADD CONSTRAINT "ai_food_choices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;