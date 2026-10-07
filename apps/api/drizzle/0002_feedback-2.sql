CREATE TABLE "photos" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photos_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "meals" ADD COLUMN "photo_id" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "macro_plan" jsonb;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;