CREATE TYPE "public"."backstory_status" AS ENUM('none', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "backstory_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"mime" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "backstory_status" "backstory_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "backstory_review" text;--> statement-breakpoint
ALTER TABLE "backstory_images" ADD CONSTRAINT "backstory_images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backstory_images_user_idx" ON "backstory_images" USING btree ("user_id");--> statement-breakpoint
-- Everyone who registered before backstory approval existed stays allowed to play.
UPDATE "users" SET "backstory_status" = 'approved';
