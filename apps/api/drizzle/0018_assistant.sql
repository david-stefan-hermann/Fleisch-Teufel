CREATE TABLE "assistant_audio" (
	"user_id" uuid NOT NULL,
	"turn_id" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_audio_user_id_turn_id_pk" PRIMARY KEY("user_id","turn_id")
);
--> statement-breakpoint
CREATE TABLE "assistant_skins" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_skins_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "assistant_turns" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"transcript" text,
	"context" jsonb,
	"ops" jsonb,
	"question" jsonb,
	"reply" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"outcome" text,
	"response" jsonb,
	CONSTRAINT "assistant_turns_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "assistant_audio" ADD CONSTRAINT "assistant_audio_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_skins" ADD CONSTRAINT "assistant_skins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_turns" ADD CONSTRAINT "assistant_turns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_audio_created_at_index" ON "assistant_audio" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "assistant_turns_user_id_created_at_index" ON "assistant_turns" USING btree ("user_id","created_at");