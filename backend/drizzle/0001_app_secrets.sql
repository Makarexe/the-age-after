CREATE TABLE "app_secrets" (
	"name" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
